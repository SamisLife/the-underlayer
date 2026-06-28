"""AI analysis and topic explanation, backed by Google Gemini.

call_llm is the single entry point to the model. Device analysis requires a key;
topic explanation falls back to the offline knowledge base (app/knowledge.py) so the
lens still works without one.
"""

import json
import logging
from typing import Any, Dict, List, Optional

import httpx

from . import knowledge
from .config import GOOGLE_API_KEY

log = logging.getLogger("underlayer.ai")

_GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)


async def call_llm(prompt: str, json_mode: bool = False, timeout: float = 90) -> str:
    """Call Google Gemini and return the raw text content.

    Raises RuntimeError if no key is configured or the call fails.
    """
    if not GOOGLE_API_KEY:
        raise RuntimeError("No AI provider configured (set GOOGLE_API_KEY)")

    payload: Dict[str, Any] = {"contents": [{"parts": [{"text": prompt}]}]}
    if json_mode:
        payload["generationConfig"] = {"responseMimeType": "application/json"}

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(f"{_GEMINI_URL}?key={GOOGLE_API_KEY}", json=payload)
    resp.raise_for_status()
    return resp.json()["candidates"][0]["content"]["parts"][0]["text"]


async def analyze_with_ai(
    raw_scan: dict,
    ar_summary: dict,
    vulnerability_matches: List[Dict[str, Any]]
) -> Dict[str, Any]:
    if not GOOGLE_API_KEY:
        return {
            "enabled": False,
            "risk_summary": "AI analysis is not configured.",
            "recommendation": "Set GOOGLE_API_KEY in .env.",
            "reasoning": [],
            "actions": []
        }

    prompt = f"""
You are the AI security agent for The Underlayer, an AR cybersecurity assistant.

A sysadmin is looking at this device through Snap Spectacles.
Return short JSON only. No markdown.

AR device card:
{json.dumps(ar_summary, indent=2)}

Known vulnerability matches:
{json.dumps(vulnerability_matches, indent=2)}

Raw device scan (Includes OS and environment details):
{json.dumps(raw_scan, indent=2)}

Return exactly this JSON structure:
{{
  "risk_summary": "one short sentence",
  "recommendation": "one short sentence",
  "reasoning": [
    "short reason 1",
    "short reason 2"
  ],
  "problems": [
    {{
      "priority": "Critical|High|Medium|Low",
      "description": "Short description of the problem",
      "fixCommand": "exact, highly efficient remediation command",
      "fixLabel": "Human readable action"
    }}
  ]
}}

Rules:
- Keep all text short for AR glasses.
- Do not invent real CVEs.
- Do not use destructive commands such as rm -rf, shutdown, reboot, mkfs, userdel.
- Every action must require human approval.

CRITICAL INSTRUCTIONS FOR fixCommand GENERATION:
You must dynamically generate the absolute most efficient and reliable `fixCommand` based on the exact OS environment found in the "Raw device scan". You must evaluate the `os` object (e.g. Kali GNU/Linux, Debian, Ubuntu) and formulate the exact appropriate command.

1. Python / pip Vulnerabilities:
If the OS is a modern Debian-based Linux (e.g. Kali, Ubuntu 24.04+, Debian 12+) and you need to upgrade a Python package, you MUST bypass PEP 668 (externally managed environment) and avoid the `uninstall-no-record-file` error.
Your command MUST be formatted exactly like this:
`sudo -H pip3 install --upgrade --ignore-installed --break-system-packages <package>==<fix_version>`
Do NOT use `pip install`. Do NOT forget `--break-system-packages` or `--ignore-installed`.

2. NPM Vulnerabilities:
Global NPM installations require `sudo` to bypass permission errors.
Your command MUST be formatted exactly like this:
`sudo npm install -g <package>@<fix_version>`

3. APT/System Packages:
When upgrading a system package via `apt-get`, you must ensure it does not prompt for user input.
Your command MUST be formatted exactly like this:
`sudo apt-get install --only-upgrade -y <package>`

You must read the `os` and `environment` fields from the raw device scan to deduce the OS type, and combine that with the `fix_version` provided in the vulnerability matches to synthesize the exact, perfectly formed command.
"""

    try:
        content = await call_llm(prompt, json_mode=True, timeout=90)
    except Exception as e:
        return {
            "enabled": False,
            "risk_summary": "AI analysis failed.",
            "recommendation": "Use rule-based findings for now.",
            "reasoning": [str(e)],
            "actions": []
        }

    try:
        parsed = json.loads(content)
        parsed["enabled"] = True
        return parsed
    except Exception:
        return {
            "enabled": True,
            "risk_summary": content,
            "recommendation": "Review AI response.",
            "reasoning": [],
            "actions": []
        }


async def explain_topic(topic: str, context: Optional[str] = None) -> str:
    """Explain a port or threat-analysis metric.

    Prefers a personalized Gemini explanation; falls back to the offline knowledge
    base (and a "wire an API key" hint for unrecognized topics) when no key is set or
    the AI call fails.
    """
    if GOOGLE_API_KEY:
        prompt = f"Explain what '{topic}' is in the context of cybersecurity and networking."
        if context:
            prompt += f"\nContext: {context}"
        prompt += "\nExplain it in 2-3 short, concise sentences. Focus on what it is and what vulnerabilities it might expose. Return only the plain text explanation, no markdown, no quotes."
        try:
            content = await call_llm(prompt, timeout=20)
            return content.strip()
        except Exception as e:
            log.warning("Gemini explain failed for '%s', using offline reference: %s", topic, e)

    return knowledge.lookup_explanation(topic) or knowledge.unknown_message(topic)
