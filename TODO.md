# GitHub Publication Checklist

## README Documentation

- [x] Write a short description of the extension and what it does.
- [x] Document requirements and compatibility, including Firefox desktop 140+ / Android 142+ for built-in data-transmission consent and the need to sign in to Rebrickable.
- [x] Explain user installation and distinguish temporary loading from a Mozilla-signed/published version.
- [x] List the formats included in the default ZIP, optional HTML exports, and the option to include building instruction files.
- [x] Add a limitations and troubleshooting section covering download failures, HTTP 429, and attachments requiring manual verification.
- [x] Explain the permissions used and privacy policy: the extension does not store credentials.
- [x] Explain how to report issues and what information to include without sharing cookies, passwords, or other sensitive data.
- [x] Replace the original URL example with a neutral or generic example.

## Assets and Publishing

- [ ] Add an extension icon and real screenshots of the popup and progress page for the AMO listing.
- [x] Choose a license (MIT) and add the `LICENSE` file.
- [x] Use GitHub Releases for version history; publish notes for each version.
- [ ] Review the Gecko ID in `manifest.json` and choose a stable ID before publishing on AMO. The current value is an example ID; replace it with one controlled by the publisher.
- [ ] Prepare AMO listing materials: summary, full description, support contact, and accurate privacy/data-use disclosures.
- [ ] Decide whether to publish a listed AMO add-on or request an unlisted signature for direct XPI distribution.
- [ ] Submit the extension to AMO for validation/review and obtain a Mozilla signature.
- [ ] Add the permanent AMO installation or download link to the README after publication/signing.
