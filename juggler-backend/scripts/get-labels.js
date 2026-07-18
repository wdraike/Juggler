const { google } = require('googleapis');
const fs = require('fs');

const token = JSON.parse(fs.readFileSync('/Users/david/Documents/Software Dev/gmail MCP/token.json', 'utf8'));
const creds = JSON.parse(fs.readFileSync('/Users/david/Documents/Software Dev/gmail MCP/credentials.json', 'utf8'));
const { client_secret, client_id, redirect_uris } = creds.installed || creds.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
oAuth2Client.setCredentials(token);

const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

async function main() {
  try {
    const res = await gmail.users.labels.list({ userId: 'me' });
    const labels = res.data.labels || [];
    for (const l of labels) {
      console.log(`Label: name='${l.name}', id='${l.id}'`);
    }
  } catch (err) {
    console.error(err);
  }
}

main();
