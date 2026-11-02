# Mahyar VPN

> **Upgrade notice:** The build/release instructions and service-coverage claims below are
> from the original project and are outdated. Use [UPGRADE-README.fa.md](UPGRADE-README.fa.md)
> for the new source build and current limitations. Connectivity has not been verified.

<div align="center">

![Mahyar VPN](build/icon.png)

**دامین‌فرانتینگ بدون سرور — فقط یک کلیک تا اینترنت آزاد**

*A serverless domain-fronting VPN for Windows — connect in one click.*

</div>

---

## Features

- **No server required** — connects directly through Google, Meta and Fastly CDNs using TLS domain fronting
- **MITM-DomainFronting v23** — the proven profile by [@patterniha](https://github.com/patterniha), ported from Android to Windows
- **Per-machine CA** — every installation generates its own certificate; nothing is shared
- **Dark glass UI** — modern cyan glow on near-black, RTL Persian interface
- **Traffic stats** — live download/upload speed and totals
- **System proxy** — Windows-wide proxy, no per-app configuration needed
- **Tiny installer** — NSIS + portable ZIP, under 50 MB

## What it connects to

The domain-fronting profile routes traffic through:

| CDN | Services | Method |
|-----|----------|--------|
| **Google** | YouTube, Google Search, Gmail, Google Drive, Google Maps | TLS SNI fronting |
| **Meta** | Instagram, WhatsApp, Facebook | TLS SNI fronting |
| **Fastly / GitHub** | GitHub, Reddit | TLS SNI fronting |

Iranian domains and private IPs route directly — no tunnel needed.

## Getting started

### 1. Install

Download the latest release from the [Releases](https://github.com/YOUR_USERNAME/mahyar-vpn/releases) page:

- **`Mahyar-VPN-Setup.exe`** — NSIS installer (recommended)
- **`Mahyar-VPN-win32-x64.zip`** — portable ZIP, no install needed

### 2. First-time setup

The first time you run Mahyar VPN you must complete two steps (shown in the UI):

1. **ساخت گواهی** — the app creates a unique TLS certificate for this machine in `~/.mahyarvpn/mitm/`
2. **نصب گواهی** — a Windows confirmation dialog opens; accept it. This certificate is how the app performs the MITM to read the real destination and re-encrypt it under an allowed front domain.

### 3. Connect

Click the power button. The proxy will be set to `127.0.0.1:10809` and all browser traffic will flow through the domain-fronting tunnel.

## Building from source

> **Large binaries (64 MB) are NOT committed** — downloaded by GitHub Actions at build time from your own release assets.

### 1. Upload binaries to your GitHub Release

Before the first build, upload 3 files as release assets:

1. **Create a draft release** (tag e.g. `v1.0.0`) on GitHub
2. **Upload these files as assets** (drag & drop):
   - `xray.exe` (~35 MB) — get from `MLM VPN\resources\app.asar.unpacked\core\xray.exe`
   - `geoip.dat` (~19 MB) — get from `MLM VPN\resources\app.asar.unpacked\core\geoip.dat`
   - `geosite.dat` (~10 MB) — get from `MLM VPN\resources\app.asar.unpacked\core\geosite.dat`
3. **Set a secret**: go to **Settings → Secrets → New secret**:
   - Name: `BIN_BASE_URL`
   - Value: `https://github.com/YOUR_USERNAME/mahyar-vpn/releases/download/v1.0.0`
     (replace YOUR_USERNAME and your tag name)

### 2. Build locally

```bash
git clone https://github.com/YOUR_USERNAME/mahyar-vpn.git
cd mahyar-vpn
npm install
npm run dist   # output in dist/
```

### 3. GitHub Actions auto-build

Every new tag triggers a build + release automatically:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## How domain fronting works here

1. The app creates a local CA certificate and installs it in your Windows certificate store
2. When you connect, Xray listens on `127.0.0.1:10808/10809` as a SOCKS/HTTP proxy
3. The MITM engine terminates TLS with your own CA, reads the real destination SNI
4. It then re-encrypts the connection to the SAME IP address but with a different, unblocked SNI (e.g. `www.google.com`)
5. The CDN sees the front SNI and forwards to the real backend — your ISP only sees the front domain

## Credits

- **MITM-DomainFronting** profile by [@patterniha](https://github.com/patterniha)
- **Xray-core** by [Project X / XTLS](https://github.com/XTLS/Xray-core) (MPL 2.0)
- Persian RTL UI design inspired by MLM VPN

## License

- App code: **MPL 2.0**
- Xray-core binary: **MPL 2.0** (see [LICENSE](LICENSE.md))
- The MITM profile is credited to @patterniha in the profile itself
