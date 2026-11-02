# Mahyar VPN — License

## App code (src/, renderer/, build/, scripts/)

Licensed under the **Mozilla Public License 2.0 (MPL 2.0)**.

You may obtain a copy of the License at https://www.mozilla.org/en-US/MPL/2.0/

## Xray-core binary (resources/core/xray.exe)

The bundled `xray.exe` is a **custom build** of [Xray-core](https://github.com/XTLS/Xray-core) by Project X, licensed under the **Mozilla Public License 2.0 (MPL 2.0)**.

The source code for this custom build is available at the [Xray-core repository](https://github.com/XTLS/Xray-core). Per the MPL 2.0, the Corresponding Source for the binary is available — if you need it, contact the maintainers or compile your own from the upstream XTLS/Xray-core repository.

If you distribute this binary as part of Mahyar VPN, you must:
- Make the source code available (or a written offer to provide it)
- Preserve all MPL 2.0 license notices in the binary and documentation
- Clearly mark any modifications you made to the original Xray-core source

## MITM-DomainFronting profile

The `mitm_domainfronting_v23.json` configuration is the work of **[@patterniha](https://github.com/patterniha)** and is used here as-is. Credit is attributed inside the profile file itself.

---

## Third-party licenses

- **electron** — MIT License
- **electron-builder** — MIT License
- **Segoe UI** — system font, Windows EULA

For full third-party license texts, run `npm run dist` and check the packaged `LICENSES.chromium.html` inside the installer resources if applicable.
