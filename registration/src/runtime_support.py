"""Platform constraints shared by setup and the browser dependency report."""
import json
import platform
import struct
import sys


def runtime_support(system=None, machine=None, mac_version=None, python_version=None, bits=None):
    system = platform.system() if system is None else system
    machine = platform.machine() if machine is None else machine
    mac_version = platform.mac_ver()[0] if mac_version is None else mac_version
    python_version = sys.version_info[:2] if python_version is None else python_version
    bits = struct.calcsize("P") * 8 if bits is None else bits
    intel_mac = system == "Darwin" and machine.lower() == "x86_64"
    error = None
    if tuple(python_version) != (3, 12) or bits != 64:
        error = "Python 3.12 en 64 bits requis"
    elif intel_mac:
        try:
            major = int(mac_version.split(".")[0])
        except (ValueError, AttributeError):
            major = 0
        if major < 15:
            error = "Mac Intel : macOS 15 ou plus récent requis pour ANTsPy 0.6.3"
    return {
        "compatible": error is None,
        "compatibilityError": error,
        "profile": "mac-intel" if intel_mac else "default",
    }


if __name__ == "__main__":
    print(json.dumps(runtime_support()))
