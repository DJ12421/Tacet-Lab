import { Icon, PageHeader, Panel } from './primitives'

const effectiveDate = 'August 10, 2026'

export function PrivacyLegalView() {
  return <div className="legal-page">
    <PageHeader
      eyebrow="Local-first by design"
      title="Privacy & Legal"
      description="A plain-language explanation of what Tacet Lab stores, what it connects to, and the boundaries of this independent fan project."
    />

    <section className="legal-highlights" aria-label="Privacy highlights">
      <Panel><Icon name="lock"/><span>Storage</span><strong>Your account data stays in this browser.</strong><p>No Tacet Lab account, backend, cloud sync, or scan uploads. Only aggregate page analytics leave the browser.</p></Panel>
      <Panel><Icon name="scan"/><span>Scanning</span><strong>Capture begins only when you approve it.</strong><p>Frames are processed locally, without audio, and every OCR result requires review before saving.</p></Panel>
      <Panel><Icon name="download"/><span>Control</span><strong>You can export or delete your data.</strong><p>Use Export for a portable JSON copy or Settings to clear the local database.</p></Panel>
    </section>

    <div className="legal-layout">
      <article className="legal-document">
        <Panel>
          <header><span>01</span><div><p>Privacy notice</p><h2>Data stored on your device</h2></div></header>
          <div className="legal-copy">
            <p>Tacet Lab stores Echoes, characters, weapons, builds, teams, preferences, and approved scan results in your browser&apos;s IndexedDB storage. Screenshots, shared-window frames, OCR text, and confidence values are processed in your browser. They are not sent to a Tacet Lab server.</p>
            <p>Unsaved capture frames remain temporary. Data persists only when you approve and save it, import a backup, or change a preference. Exported JSON files and build-card images remain under your control after your browser saves them.</p>
          </div>
        </Panel>

        <Panel>
          <header><span>02</span><div><p>Permissions</p><h2>Screen capture and OCR</h2></div></header>
          <div className="legal-copy">
            <p>The scanner requests screen-sharing permission only after you choose to start capture. Your browser displays the permission prompt and lets you select the shared surface. Tacet Lab requests video only, never audio, and cannot silently begin capture.</p>
            <p>Stopping the share or leaving the scanner ends its media tracks. Tacet Lab does not automate game input, inspect game memory, read game files, or interact with the Wuthering Waves process.</p>
          </div>
        </Panel>

        <Panel>
          <header><span>03</span><div><p>Network boundary</p><h2>External resources</h2></div></header>
          <div className="legal-copy">
            <p>Tacet Lab has no account service, advertising system, first-party backend, cloud sync, or image-upload endpoint. The published website uses privacy-focused aggregate analytics, and some visual or OCR resources require ordinary network requests.</p>
            <ul>
              <li><strong>GitHub Pages</strong> hosts the website.</li>
              <li><strong>Cloudflare Web Analytics</strong> reports aggregate page views, visits, referrers, and browser performance. Its beacon does not use cookies or access local storage, session storage, or IndexedDB. Cloudflare states that source IP addresses received during request handling are discarded at the nearest data center rather than stored in its core databases or logs.</li>
              <li><strong>Nanoka and referenced asset hosts</strong> provide catalog data, artwork, and selected character portrait files.</li>
              <li><strong>Google Fonts</strong> provides the Cinzel typeface.</li>
              <li><strong>Tesseract.js distribution hosts</strong> may provide the OCR worker, WebAssembly runtime, and English language model on first use.</li>
            </ul>
            <p>The analytics beacon does not receive Echo inventory, builds, screenshots, shared-window frames, OCR results, preferences, or exported files. Other providers may receive standard connection information such as your IP address, browser details, and the requested resource under their own policies. Tacet Lab does not combine that information with your locally stored data. Previously requested resources may be kept in normal browser or PWA caches.</p>
          </div>
        </Panel>

        <Panel>
          <header><span>04</span><div><p>Your choices</p><h2>Access, export, and deletion</h2></div></header>
          <div className="legal-copy">
            <ul>
              <li>Review every OCR candidate before it is added to your inventory.</li>
              <li>Edit or remove individual inventory records at any time.</li>
              <li>Use <strong>Export</strong> to download a versioned JSON copy and <strong>Import</strong> to restore a compatible copy.</li>
              <li>Use <strong>Delete all local data</strong> in Settings to clear Tacet Lab&apos;s IndexedDB records and reset local preferences.</li>
              <li>Use your browser controls to revoke screen-sharing permission or clear cached site resources.</li>
            </ul>
            <p>Because Tacet Lab does not operate accounts or a user database, there is no remote profile for the project to retrieve or delete.</p>
          </div>
        </Panel>

        <Panel>
          <header><span>05</span><div><p>Independent project</p><h2>Fan-project and intellectual-property notice</h2></div></header>
          <div className="legal-copy">
            <p>Tacet Lab is an independent, unofficial fan project. It is not affiliated with, sponsored by, approved by, or endorsed by Wuthering Waves, Kuro Games, or their affiliates.</p>
            <p>Wuthering Waves, Kuro Games, and all related names, characters, artwork, icons, game data, and trademarks belong to their respective owners. Their appearance identifies the game and the in-game items this tool helps players organize; it does not imply ownership or endorsement.</p>
            <p>Catalog metadata and artwork are sourced from the attributed Nanoka dataset with permission. Third-party links and source credits do not imply that those providers endorse Tacet Lab.</p>
          </div>
        </Panel>

        <Panel>
          <header><span>06</span><div><p>Use and reliability</p><h2>Accuracy, availability, and acceptable use</h2></div></header>
          <div className="legal-copy">
            <p>Tacet Lab is provided for personal, informational use. Calculations, OCR results, optimization suggestions, and catalog records may be incomplete, outdated, or incorrect. Game-data values are reproducible from pinned sources but are not represented as independently verified against the current English in-game UI.</p>
            <p>Always review scan results and important calculations yourself. To the extent permitted by applicable law, the project is provided as-is and without warranties; you are responsible for your use of it and for maintaining backups of data you want to keep.</p>
            <p>Do not use Tacet Lab to violate applicable law, the rights of others, or the Wuthering Waves terms and policies. The tool is not designed for game automation, cheating, account access, or circumvention of technical protections.</p>
          </div>
        </Panel>

        <Panel>
          <header><span>07</span><div><p>Open-source license</p><h2>Project license</h2></div></header>
          <div className="legal-copy">
            <p>Tacet Lab is distributed under the GNU General Public License version 3. The complete license and corresponding source are included with the project.</p>
            <p>The GPL license, corresponding source, and attribution apply to the distributed application code. Wuthering Waves names, artwork, and other game materials remain the property of their respective owners.</p>
          </div>
        </Panel>

        <Panel>
          <header><span>08</span><div><p>Updates and questions</p><h2>Policy changes and contact</h2></div></header>
          <div className="legal-copy">
            <p>This notice may change when Tacet Lab&apos;s features, data flows, or legal obligations change. Material changes will be published on this page with a revised effective date.</p>
            <p>Questions, corrections, or rights concerns can be submitted through the project&apos;s <a href="https://github.com/DJ12421/Tacet-Lab/issues" target="_blank" rel="noreferrer">GitHub issue tracker</a>. Do not include screenshots, exports, account details, or other private information in a public issue.</p>
          </div>
        </Panel>
      </article>

      <aside className="legal-aside">
        <Panel>
          <span className="eyebrow">At a glance</span>
          <dl>
            <div><dt>Effective</dt><dd>{effectiveDate}</dd></div>
            <div><dt>Accounts</dt><dd>None</dd></div>
            <div><dt>Cloud storage</dt><dd>None</dd></div>
            <div><dt>Analytics</dt><dd>Aggregate only</dd></div>
            <div><dt>Advertising</dt><dd>None</dd></div>
            <div><dt>Audio capture</dt><dd>Never</dd></div>
            <div><dt>Saved data</dt><dd>Browser only</dd></div>
          </dl>
        </Panel>
        <Panel>
          <span className="eyebrow">Community & support</span>
          <a href="https://discord.gg/fy66NmapWb" target="_blank" rel="noreferrer">Join the Tacet Lab Discord <span>↗</span></a>
          <a href="https://github.com/DJ12421/Tacet-Lab/issues" target="_blank" rel="noreferrer">GitHub issue tracker <span>↗</span></a>
        </Panel>
        <Panel>
          <span className="eyebrow">Official references</span>
          <a href="https://wutheringwaves.kurogames.com/p/language_en/privacy_policy.html" target="_blank" rel="noreferrer">Wuthering Waves Privacy Policy <span>↗</span></a>
          <a href="https://wutheringwaves.kurogames.com/p/language_en/terms_of_service.html" target="_blank" rel="noreferrer">Wuthering Waves Terms of Service <span>↗</span></a>
          <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noreferrer">GitHub Privacy Statement <span>↗</span></a>
          <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Cloudflare Privacy Policy <span>↗</span></a>
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy <span>↗</span></a>
          <a href="https://ww.nanoka.cc/" target="_blank" rel="noreferrer">Nanoka <span>↗</span></a>
        </Panel>
        <p className="legal-note">This page describes Tacet Lab&apos;s current behavior in plain language. It is not legal advice and does not replace the policies of linked third-party services.</p>
      </aside>
    </div>
  </div>
}
