"""Remote command execution over SSH (remediation actions).

Lives outside the routers so both the relay (approve-action) and the scanner
(/api/ssh/run-command) can call it directly in-process, without importing each other.
"""

import logging

from ..config import SSH_PORT
from ..models import BluetoothDevice, MatchedDevice
from .classify import HOSTS, build_matched_device
from .scanner import SSHScanner

log = logging.getLogger("underlayer.ssh")


def run_command_on_host(hostname: str, command: str) -> dict:
    """Run a command on a known host via SSH. Credentials are resolved from hosts.json."""
    bt_mock = BluetoothDevice(name=hostname, mac=hostname)
    matched = build_matched_device(bt_mock)

    if not matched:
        # Fallback to direct hostname match if bt_mock fails
        for h in HOSTS:
            if h.get("hostname") == hostname:
                matched = MatchedDevice(
                    hostname=h.get("hostname"),
                    ssh_port=h.get("ssh_port", SSH_PORT),
                    ssh_user=h.get("ssh_user"),
                    ssh_password=h.get("ssh_password"),
                    ssh_key_path=h.get("ssh_key_path"),
                )
                break

    if not matched:
        return {"ok": False, "error": f"Host '{hostname}' not found in hosts.json"}

    scanner = SSHScanner(
        host     = matched.hostname,
        port     = matched.ssh_port,
        username = matched.ssh_user     or "ubuntu",
        password = matched.ssh_password or "",
        key_path = matched.ssh_key_path or "",
    )

    if not scanner.connect():
        return {"ok": False, "error": "SSH connection failed"}

    try:
        cmd_to_run = command
        # If using sudo and a password is known, inject it via stdin using -S.
        # NOTE: this exposes the password in the remote process list — acceptable
        # only for a controlled demo network.
        if "sudo " in cmd_to_run and matched.ssh_password:
            cmd_to_run = cmd_to_run.replace("sudo ", f"echo '{matched.ssh_password}' | sudo -S ", 1)

        log.info("Executing remote command on %s: %s", hostname, cmd_to_run.replace(f"'{matched.ssh_password}'", "'***'"))

        stdout = scanner.run(cmd_to_run, timeout=30)

        if stdout:
            log.info("Command output:\n%s", stdout)
        else:
            log.info("Command completed with no output.")

        return {"ok": True, "stdout": stdout}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        scanner.close()
