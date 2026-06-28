"""Offline knowledge base for the /api/learn endpoint.

Lets the lens explain well-known ports and the threat-analysis radar metrics without
any API key. When GOOGLE_API_KEY is set the explanation is upgraded to a personalized
AI answer; this module is the no-key fallback (and the safety net if the AI call fails).

The lens sends topics like "Port 22" (port taps) or "METRIC: DENSITY" (radar-metric
taps); see DeviceDetailPanel.ts. Explanations are plain prose — /api/learn word-wraps
them for the 3D text panel.
"""

import re
from typing import Optional

# ── Threat-analysis radar metrics ─────────────────────────────────────────────
# The five axes of the spider-web chart in DeviceDetailPanel's right monitor.
METRIC_EXPLANATIONS = {
    "DENSITY": (
        "Vulnerability density measures how many known CVEs are packed across this "
        "device's installed software. A high score means many packages have published "
        "security flaws, giving an attacker more potential ways in."
    ),
    "NETWORK": (
        "Network exposure reflects how many ports and services this device leaves open "
        "to others. Every open port is a doorway — the more that are reachable, the "
        "larger the attack surface an intruder can probe."
    ),
    "PRIVESC": (
        "Privilege escalation risk estimates how easily an attacker with basic access "
        "could become root or admin. It rises with risky SUID binaries, weak sudo rules, "
        "and unpatched local kernel flaws."
    ),
    "OS": (
        "OS risk reflects the operating system's age and patch level. Older or "
        "unsupported systems miss security fixes, so publicly known exploits are far "
        "more likely to still work."
    ),
    "CONFIG": (
        "Configuration hardening looks at how safely the device is set up — default "
        "passwords, exposed admin panels, and unencrypted services. Poor configuration "
        "can expose a device even when its software is fully patched."
    ),
}

# ── Well-known ports ──────────────────────────────────────────────────────────
PORT_EXPLANATIONS = {
    21: (
        "Port 21 is FTP, a legacy file-transfer service. It sends usernames and "
        "passwords in plain text, so anyone sniffing the network can capture them — "
        "prefer SFTP or FTPS instead."
    ),
    22: (
        "Port 22 is SSH, encrypted remote shell access. It is the safe way to manage a "
        "machine, but it is also a prime target for password brute-forcing, so use keys "
        "and disable root login."
    ),
    23: (
        "Port 23 is Telnet, an old remote-login protocol. It is completely unencrypted, "
        "exposing credentials and sessions to eavesdroppers — it should be disabled in "
        "favor of SSH."
    ),
    25: (
        "Port 25 is SMTP, used to send email between mail servers. Misconfigured SMTP can "
        "be abused as an open relay to send spam, so it should require authentication and "
        "be restricted."
    ),
    53: (
        "Port 53 is DNS, which resolves names to IP addresses. An exposed or "
        "misconfigured resolver can be abused for cache poisoning or amplification "
        "attacks, so it should not be openly recursive."
    ),
    80: (
        "Port 80 is HTTP, unencrypted web traffic. Anything served here can be read or "
        "modified in transit, so sites should redirect to HTTPS (port 443) instead."
    ),
    110: (
        "Port 110 is POP3, used to download email. In its plain form it transmits "
        "credentials unencrypted, so it should only be used over TLS (POP3S)."
    ),
    143: (
        "Port 143 is IMAP, used to read email on the server. Unencrypted IMAP exposes "
        "credentials and messages, so it should be used over TLS (IMAPS) instead."
    ),
    443: (
        "Port 443 is HTTPS, encrypted web traffic. It is the secure default for websites; "
        "the main risks are outdated TLS versions or expired certificates rather than the "
        "port itself."
    ),
    3000: (
        "Port 3000 commonly hosts a Node.js or development web server. These are often "
        "left exposed without authentication or HTTPS, so it should not be reachable from "
        "untrusted networks."
    ),
    3306: (
        "Port 3306 is MySQL, a database server. Databases should never be exposed to the "
        "public internet — an open MySQL port invites brute-force and data-theft attempts."
    ),
    3389: (
        "Port 3389 is RDP, Windows Remote Desktop. It is a frequent ransomware entry "
        "point; it should sit behind a VPN and require strong, MFA-protected credentials."
    ),
    5000: (
        "Port 5000 often hosts a Flask or other development web server. Such servers are "
        "not hardened for production and should not be exposed to untrusted networks."
    ),
    5432: (
        "Port 5432 is PostgreSQL, a database server. Like any database it should be bound "
        "to internal networks only — an exposed port is a direct target for data theft."
    ),
    5683: (
        "Port 5683 is CoAP, a lightweight protocol for IoT devices. It is often "
        "unauthenticated and can be abused for amplification attacks, so it should be "
        "restricted to local IoT segments."
    ),
    5900: (
        "Port 5900 is VNC, remote screen sharing. Many VNC servers use weak or no "
        "authentication and no encryption, so it should be tunneled over SSH or a VPN."
    ),
    6379: (
        "Port 6379 is Redis, an in-memory data store. Redis has no authentication by "
        "default, so an exposed instance can be read, wiped, or used to gain code "
        "execution — keep it internal."
    ),
    8080: (
        "Port 8080 is an alternate HTTP port, often a proxy or app server. Traffic here "
        "is usually unencrypted, so it should be limited to trusted networks or fronted "
        "by HTTPS."
    ),
    8443: (
        "Port 8443 is an alternate HTTPS port, often an admin or app console. It is "
        "encrypted, but exposed management consoles are high-value targets and should be "
        "access-restricted."
    ),
    8883: (
        "Port 8883 is MQTT (TLS), a messaging protocol for IoT. If left unauthenticated "
        "it lets anyone read or publish device messages, so it must require credentials "
        "and proper certificates."
    ),
    9200: (
        "Port 9200 is Elasticsearch's HTTP API. Open Elasticsearch instances are a common "
        "cause of large data leaks, so it must never be exposed without authentication."
    ),
    27017: (
        "Port 27017 is MongoDB, a database server. Unsecured MongoDB instances have leaked "
        "millions of records; it should be bound to localhost or an internal network with "
        "authentication enabled."
    ),
}


def lookup_explanation(topic: str) -> Optional[str]:
    """Return an offline explanation for a port or metric topic, or None if unknown."""
    t = (topic or "").strip()

    port_match = re.search(r"port\D*(\d+)", t, re.IGNORECASE)
    if port_match:
        return PORT_EXPLANATIONS.get(int(port_match.group(1)))

    key = t.upper().replace("METRIC:", "").strip()
    return METRIC_EXPLANATIONS.get(key)


def unknown_message(topic: str) -> str:
    """Message shown when a topic isn't in the offline base and no API key is set."""
    t = (topic or "").strip()
    if re.search(r"port\D*\d+", t, re.IGNORECASE):
        return (
            "This port is not recognized. Add a GOOGLE_API_KEY to the backend .env "
            "to get a personalized AI explanation."
        )
    return (
        f"'{t}' is not in the offline reference. Add a GOOGLE_API_KEY to the backend "
        ".env to get a personalized AI explanation."
    )
