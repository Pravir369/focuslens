"""Short-lived delivery jobs and app-name leases, partitioned by verified user."""
import secrets
import threading
import time
import uuid

import requests
from email_reports import MailConfig, ReportDeliveryError, report_content, send_report


class Services:
    def __init__(self, env, sender=None):
        self.lock=threading.RLock(); self.reports={}; self.leases={}; self.windows={}; self.pairs={}; self.devices={}
        self.brevo_key=env.get('BREVO_API_KEY',''); self.sender_email=env.get('REPORT_FROM_EMAIL','')
        self.mail=MailConfig(env.get('SMTP_HOST','smtp.gmail.com'),int(env.get('SMTP_PORT','465')),env.get('SMTP_USERNAME',''),env.get('SMTP_APP_PASSWORD',''),env.get('SMTP_FROM') or env.get('SMTP_USERNAME',''),env.get('SMTP_SECURITY','ssl'))
        self.transport=env.get('REPORT_TRANSPORT','brevo' if self.brevo_key else 'smtp')
        self.sender=sender or self.deliver
    @property
    def configured(self): return bool(self.brevo_key and self.sender_email) if self.transport=='brevo' else self.mail.configured
    def deliver(self, summary, addresses):
        if self.transport!='brevo': return send_report(self.mail,summary,addresses)
        text,html=report_content(summary); sent=0
        for address in addresses:
            try:
                response=requests.post('https://api.brevo.com/v3/smtp/email',headers={'api-key':self.brevo_key,'Content-Type':'application/json'},json={
                    'sender':{'name':'FocusLens','email':self.sender_email},'to':[{'email':address}],
                    'subject':'Your FocusLens session report','textContent':text,'htmlContent':html},timeout=20,allow_redirects=False)
                if response.status_code!=201: raise ValueError('Provider did not accept message')
            except (requests.RequestException,ValueError):
                raise ReportDeliveryError('Email delivery was not confirmed. Check your inbox before retrying.',sent) from None
            sent+=1
        return sent
    def queue(self, owner, summary, addresses):
        job_id=str(uuid.uuid4()); now=time.time()
        with self.lock:
            self.reports={key:job for key,job in self.reports.items() if now-job['createdAt']<3600}
            if sum(job['userId']==owner and now-job['createdAt']<600 for job in self.reports.values())>=5 or len(self.reports)>=100: raise ValueError('Too many reports. Please wait before sending again.')
            job=dict(userId=owner,reportId=job_id,status='sending',sentCount=0,error='',createdAt=now); self.reports[job_id]=job
        def work():
            try: result=dict(status='accepted',sentCount=self.sender(summary,addresses))
            except ReportDeliveryError as error: result=dict(status='failed',sentCount=error.sent_count,error=str(error))
            except Exception: result=dict(status='failed',error='Delivery was not confirmed. Check your inbox before retrying.')
            with self.lock: job.update(result)
        threading.Thread(target=work,daemon=True,name='focuslens-account-report').start()
        return self.public_job(job)
    @staticmethod
    def public_job(job): return {key:job[key] for key in ('reportId','status','sentCount','error')}
    def pair(self, owner):
        now=time.time(); code=secrets.token_urlsafe(18)
        with self.lock:
            self.pairs={key:value for key,value in self.pairs.items() if value['expires']>now and value['owner']!=owner}
            if len(self.pairs)>=1000: raise ValueError('Pairing is busy. Please retry later.')
            self.pairs[code]=dict(owner=owner,expires=now+120)
        return code
    def device_active(self, owner, device):
        with self.lock:
            row=self.devices.get(device)
            return bool(row and row['owner']==owner and row['expires']>time.time())
    def active(self, owner):
        now=time.time()*1000
        candidates=[row for (uid,_),row in self.leases.items() if uid==owner and row['active'] and row['monitorEnabled'] and now-row['updatedAt']<=10000]
        return max(candidates,key=lambda row:row['updatedAt']) if candidates else None
