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
from .config import GEMINI_MODEL, GOOGLE_API_KEY

log = logging.getLogger("underlayer.ai")

_GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models"


def _scan_context(raw_scan: dict) -> dict:
    """The minimal slice of the scan the model needs to reason about fixes.

    Drops the bulky lists (apt/pip/npm packages, services, suid bins, …) — the vulnerable
    packages are already supplied separately as vulnerability matches — keeping only what
    the model uses to pick the right command style. Big latency/cost win.
    """
    return {
        "os": raw_scan.get("os"),
        "environment": raw_scan.get("environment"),
        "hardware": raw_scan.get("hardware"),
        "network": raw_scan.get("network"),
        "security_updates": raw_scan.get("security_updates"),
    }


async def call_llm(prompt: str, json_mode: bool = False,
                   max_output_tokens: Optional[int] = None, timeout: float = 60) -> str:
    """Call Google Gemini and return the raw text content.

    Raises RuntimeError if no key is configured or the call fails.
    """
    if not GOOGLE_API_KEY:
        raise RuntimeError("No AI provider configured (set GOOGLE_API_KEY)")

    gen_config: Dict[str, Any] = {}
    if json_mode:
        gen_config["responseMimeType"] = "application/json"
    if max_output_tokens:
        gen_config["maxOutputTokens"] = max_output_tokens
    # 2.5 models "think" before answering, which adds latency; a 0 budget disables it.
    if "2.5" in GEMINI_MODEL:
        gen_config["thinkingConfig"] = {"thinkingBudget": 0}

    payload: Dict[str, Any] = {"contents": [{"parts": [{"text": prompt}]}]}
    if gen_config:
        payload["generationConfig"] = gen_config

    url = f"{_GEMINI_API}/{GEMINI_MODEL}:generateContent?key={GOOGLE_API_KEY}"
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload)
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

Device OS / environment:
{json.dumps(_scan_context(raw_scan), indent=2)}

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
- Return at most 6 problems, ordered by priority (most severe first).
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
        content = await call_llm(prompt, json_mode=True, max_output_tokens=2048, timeout=45)
    except Exception as e:
        return {
            "enabled": False,
            "risk_summary": "AI analysis failed.",
            "recommendation": "Use rule-based findings for now.",
            "reasoning": [str(e)],
            "actions": []
        }

    # Defensive: strip a ```json ... ``` fence if the model added one.
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    try:
        parsed = json.loads(text)
        parsed["enabled"] = True
        return parsed
    except Exception as e:
        log.warning("Analyze: could not parse model JSON (%s) — likely truncated; "
                    "falling through to offline analyzer.", e)
        # Signal failure so analyze_device falls back to the offline analyzer (which
        # returns real problems) instead of showing a wrapped, problem-less response.
        return {
            "enabled": False,
            "risk_summary": "AI analysis returned an unparseable response.",
            "recommendation": "Use rule-based findings for now.",
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
            content = await call_llm(prompt, max_output_tokens=256, timeout=15)
            return content.strip()
        except Exception as e:
            log.warning("Gemini explain failed for '%s', using offline reference: %s", topic, e)

    return knowledge.lookup_explanation(topic) or knowledge.unknown_message(topic)
