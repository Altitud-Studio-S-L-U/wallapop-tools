# Security reporting

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/Altitud-Studio-S-L-U/wallapop-tools/security/advisories/new), or contact [info@altitudstudio.ad](mailto:info@altitudstudio.ad). Include the affected extension version, expected and observed behavior, and reproduction steps using synthetic accounts or mocked requests. Do not include authentication tokens, passwords, real listing data or browser-profile archives.

Please avoid publishing exploit details in a public issue before the maintainers have reviewed the report. This project has no paid support agreement or guaranteed response time. Fixes are developed against the current `main` branch; older release branches are not maintained separately.

## Trust boundaries

The extension observes authentication headers from configured Wallapop pages and can make listing changes with that session. Install it only from source or a release you have inspected. It does not protect a session from a compromised browser, another privileged extension or malicious code already executing in the Wallapop page.

Account verification, inventory checks and the shared operation lock limit accidental cross-session or overlapping writes. They do not cancel requests already sent, undo completed listing changes or provide a durable transaction. The lock is held in service-worker memory. Scheduling preferences are shared across the installation, so a schedule uses the account session active when it runs.

See [PRIVACY.md](PRIVACY.md) for storage, network requests and removal controls. Tests use synthetic data; a passing test suite is not an assurance about current Wallapop API compatibility or a security certification.
