"""Provision an isolated iPhone for the nightly native iOS run (scripts/nightly-ios.sh).

SafariDriver owns browser automation. This script provisions and boots the
simulator; it never reuses an existing device or another T3 session's simulator.
"""

import json
import os
import subprocess


def simctl(*args):
    return subprocess.check_output(["xcrun", "simctl", *args], text=True).strip()


def version(value):
    return tuple(int(part) for part in value.split("."))


inventory = json.loads(simctl("list", "--json", "runtimes", "devicetypes"))
runtimes = sorted(
    (
        runtime
        for runtime in inventory["runtimes"]
        if runtime.get("isAvailable") and ".iOS-" in runtime["identifier"]
    ),
    key=lambda runtime: version(runtime["version"]),
    reverse=True,
)
if not runtimes:
    raise SystemExit("No available iOS Simulator runtime; native iOS gate cannot run")
runtime = runtimes[0]
types = runtime.get("supportedDeviceTypes", [])
phones = [device for device in types if device.get("productFamily") == "iPhone"]
if not phones:
    # Older simctl versions omit supportedDeviceTypes on runtime records.
    runtime_version = version(runtime["version"])
    phones = [
        device
        for device in inventory["devicetypes"]
        if device.get("productFamily") == "iPhone"
        and version(device["minRuntimeVersionString"]) <= runtime_version
        <= version(device["maxRuntimeVersionString"])
    ]
if not phones:
    raise SystemExit("No compatible iPhone type; native iOS gate cannot run")
device = phones[0]
udid = simctl("create", "Airtime frame regression", device["identifier"], runtime["identifier"])
print(f"Created {device['name']} / iOS {runtime['version']} / {udid}", flush=True)
# First boot can exceed SafariDriver's connection timeout. Prepare the isolated
# CI device fully before asking SafariDriver to launch the browser.
simctl("boot", udid)
subprocess.run(["xcrun", "simctl", "bootstatus", udid, "-b"], check=True, timeout=240)
with open(os.environ["GITHUB_OUTPUT"], "a") as output:
    output.write(f"udid={udid}\n")
