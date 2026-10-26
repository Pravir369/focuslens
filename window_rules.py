"""App-name rules only: no screenshots, page contents, or browser tabs."""
DEFAULT_BLOCKLIST = ("YouTube", "Instagram", "TikTok", "Discord", "Steam", "Roblox", "Minecraft", "Fortnite", "Epic Games Launcher")
ALIASES = {"chrome": "google chrome", "edge": "microsoft edge"}


def normalized(value):
    value = value.strip().casefold()
    return ALIASES.get(value, value)


def is_on_task(app_name, allowed_apps):
    name = normalized(app_name)
    if name in {normalized(item) for item in allowed_apps}:
        return True
    if name in {normalized(item) for item in DEFAULT_BLOCKLIST}:
        return False
    return False  # Empty allow-list and unknown apps are honestly off-task.


def allowed_apps(value):
    if not isinstance(value, list) or len(value) > 20 or any(not isinstance(item, str) or not item.strip() or len(item) > 80 for item in value):
        raise ValueError("Choose up to 20 app names, each under 80 characters.")
    return list(dict.fromkeys(item.strip() for item in value))
