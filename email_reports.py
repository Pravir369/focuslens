"""Opt-in reports only. No recipients, reports, or credentials are logged."""
import html
import os
import re
import shlex
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from pathlib import Path


def local_environment(path):
    values = {}
    if Path(path).is_file():
        for line in Path(path).read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if re.fullmatch(r"[A-Z][A-Z0-9_]*", key.strip()):
                parts = shlex.split(value, comments=True)
                values[key.strip()] = " ".join(parts)
    return {**values, **os.environ}


@dataclass(frozen=True)
class MailConfig:
    host: str = "smtp.gmail.com"
    port: int = 465
    username: str = ""
    password: str = ""
    sender: str = ""
    security: str = "ssl"

    @classmethod
    def load(cls, path):
        try:
            env = local_environment(path)
            username = env.get("SMTP_USERNAME", "")
            return cls(env.get("SMTP_HOST", "smtp.gmail.com"), int(env.get("SMTP_PORT", "465")), username,
                       env.get("SMTP_APP_PASSWORD", ""), env.get("SMTP_FROM") or username, env.get("SMTP_SECURITY", "ssl"))
        except (ValueError, OSError):
            return cls()  # Misconfigured optional email must not prevent startup.

    @property
    def configured(self):
        return bool(self.username and self.password and self.sender and self.security in ("ssl", "starttls"))


def recipients(values):
    if not isinstance(values, list) or not 1 <= len(values) <= 2:
        raise ValueError("Enter one or two recipient email addresses.")
    result = []
    for value in values:
        if not isinstance(value, str) or len(value) > 254 or not re.fullmatch(r"[^@\s,<>]+@[^@\s,<>]+\.[^@\s,<>]+", value):
            raise ValueError("Enter valid email addresses, without names or line breaks.")
        if value.casefold() not in [item.casefold() for item in result]:
            result.append(value)
    return result


def validate_summary(value):
    if not isinstance(value, dict):
        raise ValueError("A session summary is required.")
    def field(obj, key, limit=2000):
        item = obj.get(key)
        if not isinstance(item, str) or len(item) > limit:
            raise ValueError("Invalid session summary text.")
        return item
    headlines = value.get("headlineStats")
    if not isinstance(headlines, dict):
        raise ValueError("Summary headline stats are required.")
    clean = {key: field(value, key) for key in ("title", "completedAt", "goalFeedback", "patternTip")}
    clean["headlineStats"] = {key: field(headlines, key) for key in ("recovery", "engagement", "distractions", "longest")}
    timeline = value.get("timeline")
    if not isinstance(timeline, list) or len(timeline) > 5000:
        raise ValueError("Invalid session timeline.")
    clean["timeline"] = []
    for row in timeline:
        if not isinstance(row, dict):
            raise ValueError("Invalid timeline row.")
        clean["timeline"].append({key: field(row, key, 500) for key in ("state", "start", "end", "duration")})
    return clean


def report_content(summary):
    stats = list(summary["headlineStats"].values())
    timeline = [f"{row['start']} – {row['end']}: {row['state']} ({row['duration']})" for row in summary["timeline"]]
    text = "\n\n".join([summary["title"], summary["completedAt"], *stats, summary["goalFeedback"], summary["patternTip"], "Timeline\n" + ("\n".join(timeline) or "No elapsed time to display.")])
    # Escape every client-supplied value; email is a static text/HTML report.
    paragraphs = "".join(f"<p>{html.escape(line)}</p>" for line in [*stats, summary["goalFeedback"], summary["patternTip"]])
    rows = "".join("<tr>" + "".join(f"<td>{html.escape(row[key])}</td>" for key in ("state", "start", "end", "duration")) + "</tr>" for row in summary["timeline"])
    markup = f"<html><body><h1>FocusLens session report</h1><p>{html.escape(summary['completedAt'])}</p>{paragraphs}<h2>Timeline</h2><table><tr><th>State</th><th>Start</th><th>End</th><th>Duration</th></tr>{rows}</table></body></html>"
    return text, markup


class ReportDeliveryError(Exception):
    def __init__(self, message, sent_count=0):
        super().__init__(message)
        self.sent_count = sent_count


def send_report(config, summary, addresses, smtp_factory=None):
    if not config.configured:
        raise ReportDeliveryError("Email is not configured. Set SMTP credentials in the local .env file, then restart FocusLens.")
    context = ssl.create_default_context()
    sent = 0
    try:
        factory = smtp_factory or (smtplib.SMTP_SSL if config.security == "ssl" else smtplib.SMTP)
        kwargs = {"timeout": 20}
        if config.security == "ssl":
            kwargs["context"] = context
        text, markup = report_content(summary)
        with factory(config.host, config.port, **kwargs) as smtp:
            if config.security == "starttls":
                smtp.ehlo(); smtp.starttls(context=context); smtp.ehlo()
            smtp.login(config.username, config.password)
            for address in addresses:
                message = EmailMessage()
                message["Subject"] = "Your FocusLens session report"
                message["From"] = config.sender
                message["To"] = address  # Separate messages keep recipients private.
                message.set_content(text)
                message.add_alternative(markup, subtype="html")
                refused = smtp.send_message(message)
                if refused:
                    raise smtplib.SMTPRecipientsRefused(refused)
                sent += 1
        return sent
    except Exception as error:
        if sent:
            message = f"Sent to {sent} recipient. Delivery to the remaining recipient was not confirmed; check before retrying."
        elif isinstance(error, smtplib.SMTPAuthenticationError):
            message = "Email authentication failed. Check the configured sending account and app password."
        else:
            message = "Email delivery was not confirmed. Check your connection, SMTP configuration, and inbox before retrying."
        raise ReportDeliveryError(message, sent) from None
