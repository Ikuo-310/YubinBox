# Third-party notices

YubinBox's own code is AGPL-3.0-only. Third-party code retains its original license and notices.

## InboxSDK

- Package: `@inboxsdk/core` **2.2.24** (Streak).
- Source: https://github.com/InboxSDK/InboxSDK/tree/ec7ea453503a081061a573e97ad0cd32d415f864
- Distribution: https://registry.npmjs.org/@inboxsdk/core/-/core-2.2.24.tgz
- Upstream license expression: `(MIT OR Apache-2.0)`. This PoC uses the MIT option.
- Original notices: [COPYRIGHT.txt](third-party/inboxsdk/COPYRIGHT.txt), [LICENSE-MIT.txt](third-party/inboxsdk/LICENSE-MIT.txt), [LICENSE-APACHE.txt](third-party/inboxsdk/LICENSE-APACHE.txt).

The npm archive does not include these standalone license files. They were retrieved verbatim from the distribution's `gitHead` commit shown above. The build copies these notices into the extension alongside the original SDK bundles and source maps. Embedded third-party comments, copyright statements and terms links in those files are preserved verbatim, including notices for code bundled by InboxSDK. Do not strip them during packaging.

The npm dependency graph and integrity hashes are recorded in `package-lock.json`; installed packages retain their own notices in `node_modules`. The PoC copies only the prebuilt InboxSDK bundles/maps, not the installed dependency tree. There is no bundler or additional direct runtime dependency. If future builds bundle additional packages, include their required licenses and notices too.
