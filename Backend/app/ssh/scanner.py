"""SSHScanner — connect to a host over SSH and run the inventory command set."""

import logging
from pathlib import Path
from typing import Any, Dict, Optional

import paramiko

from ..config import CMD_TIMEOUT, SSH_TIMEOUT
from .classify import COMMANDS

log = logging.getLogger("underlayer.ssh")


class SSHScanner:
    def __init__(self, host: str, port: int, username: str,
                 password: str = "", key_path: str = ""):
        self.host     = host
        self.port     = port
        self.username = username
        self.password = password
        self.key_path = key_path
        self._client: Optional[paramiko.SSHClient] = None

    def connect(self) -> bool:
        client = paramiko.SSHClient()
        # NOTE: AutoAddPolicy trusts unknown host keys. Acceptable for a controlled
        # lab/demo network; do not use against untrusted hosts unchanged.
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        kwargs: Dict[str, Any] = dict(
            hostname      = self.host,
            port          = self.port,
            username      = self.username,
            timeout       = SSH_TIMEOUT,
            look_for_keys = False,
            allow_agent   = False,
        )
        resolved_key = Path(self.key_path).expanduser() if self.key_path else None
        if resolved_key and resolved_key.exists():
            kwargs["key_filename"] = str(resolved_key)
        elif self.password:
            kwargs["password"] = self.password
        else:
            kwargs["look_for_keys"] = True
            kwargs["allow_agent"]   = True

        try:
            client.connect(**kwargs)
            self._client = client
            log.info("SSH connected  %s@%s:%d", self.username, self.host, self.port)
            return True
        except Exception as exc:
            log.error("SSH connect failed %s: %s", self.host, exc)
            return False

    def run(self, cmd: str, timeout: int = CMD_TIMEOUT) -> str:
        if not self._client:
            return ""
        try:
            _, stdout, stderr = self._client.exec_command(cmd, timeout=timeout)
            stdout.channel.settimeout(timeout)
            out = stdout.read().decode("utf-8", errors="replace").strip()
            err = stderr.read().decode("utf-8", errors="replace").strip()
            if err and not out:
                return err
            elif err and out:
                return f"{out}\n{err}"
            return out
        except Exception as exc:
            log.debug("Command failed [%.60s]: %s", cmd, exc)
            return f"Error/Timeout: {exc}"

    def close(self):
        if self._client:
            self._client.close()
            self._client = None

    def collect(self) -> Dict[str, str]:
        raw: Dict[str, str] = {}
        for key, cmd in COMMANDS.items():
            log.debug("  cmd: %s", key)
            raw[key] = self.run(cmd)
        return raw
