// Ad-hoc code signing when no Developer ID is available: Apple Silicon refuses unsigned binaries and Gatekeeper
// reports them as "damaged"; an ad-hoc signature lets people use System Settings › Privacy & Security › Open Anyway.
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${app}`);
};
