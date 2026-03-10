const fs = require('fs');
const { mdToPdf } = require('md-to-pdf');

(async () => {
  const pdf = await mdToPdf(
    { path: 'NoHack-System.md' },
    {
      launch_options: {
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        timeout: 60000,
      },
    }
  );

  if (pdf) {
    fs.writeFileSync('NoHack-System.pdf', pdf.content);
    console.log('PDF created: NoHack-System.pdf');
  }
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
