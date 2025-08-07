const express = require('express');
const axios = require('axios');
const inquirer = require('inquirer'); // ✅ only once
const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');


// Fix for open module
let open;
try {
  open = require('open').default || require('open');
} catch (e) {
  console.error("🚫 The 'open' package is not installed. Run: npm install open");
  process.exit(1);
}

const CLIENT_ID = 'Ov23liqQvPAWWmOeDPj6';
const CLIENT_SECRET = '34b0f57b6bb113c2ad646a63850bb75b9969fe55';
const REDIRECT_URI = 'http://localhost:3000/callback';

async function authenticateWithGitHub() {
  return new Promise((resolve, reject) => {
    const app = express();

    const server = app.listen(3000, () => {
      console.log('🔐 Waiting for GitHub authentication...');
    });

    app.get('/callback', async (req, res) => {
      const code = req.query.code;
      try {
        const tokenRes = await axios.post(
          'https://github.com/login/oauth/access_token',
          {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            redirect_uri: REDIRECT_URI,
          },
          {
            headers: { Accept: 'application/json' },
          }
        );

        const accessToken = tokenRes.data.access_token;
        res.send('✅ Authentication successful! You can close this tab.');
        server.close();
        resolve(accessToken);
      } catch (err) {
        console.error('❌ Error getting access token:', err);
        res.send('❌ Error during authentication.');
        server.close();
        reject(err);
      }
    });

    open(
      `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=repo`
    );
  });
}

async function createGitHubRepo(token, name, isPrivate) {
  const res = await axios.post(
    'https://api.github.com/user/repos',
    {
      name,
      private: isPrivate,
    },
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  );

  return res.data.clone_url;
}

async function chooseLicense(token) {
  const licenses = ['mit', 'apache-2.0', 'gpl-3.0', 'unlicense', 'none'];

  const { license } = await inquirer.prompt([
    {
      type: 'list',
      name: 'license',
      message: 'Choose a license:',
      choices: licenses,
    },
  ]);

  if (license === 'none') return;

  const res = await axios.get(`https://api.github.com/licenses/${license}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  fs.writeFileSync('LICENSE', res.data.body);
}

function createReadme(projectName, license) {
  const readme = `# ${projectName}\n\nThis project is licensed under the ${license.toUpperCase()} license.`;
  fs.writeFileSync('README.md', readme);
}

async function run() {
  const git = simpleGit();

  const accessToken = await authenticateWithGitHub();

  const { repoName, visibility } = await inquirer.prompt([
    {
      type: 'input',
      name: 'repoName',
      message: 'Enter the name of the repository:',
    },
    {
      type: 'list',
      name: 'visibility',
      message: 'Select repository visibility:',
      choices: ['public', 'private'],
    },
  ]);

  try {
    const cloneUrl = await createGitHubRepo(
      accessToken,
      repoName,
      visibility === 'private'
    );

    await chooseLicense(accessToken);
    createReadme(repoName, visibility);

    const isGit = fs.existsSync('.git');

    if (!isGit) {
      await git.init();
      await git.addRemote('origin', cloneUrl);
    } else {
      const { reuse } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'reuse',
          message:
            '⚠️ This folder is already a Git repo. Do you want to reuse it?',
        },
      ]);

      if (!reuse) {
        console.log('❌ Operation cancelled.');
        return;
      }

      const remotes = await git.getRemotes(true);
      if (remotes.find((r) => r.name === 'origin')) {
        await git.removeRemote('origin');
      }
      await git.addRemote('origin', cloneUrl);
    }

const branches = await git.branchLocal();

if (!branches.all.includes('main')) {
  console.log("🔧 'main' branch not found. Creating it...");
  await git.checkoutLocalBranch('main'); // create new main branch
} else {
  console.log("✅ 'main' branch already exists. Using it...");
  await git.checkout('main'); // switch to existing main
}

await git.add('.');
await git.commit('Initial commit');
await git.push('origin', 'main', { '--set-upstream': null });


    console.log(`🚀 Project uploaded to GitHub: ${cloneUrl}`);
    await open(cloneUrl);
  } catch (err) {
    if (err.response && err.response.status === 422) {
      console.error('❌ A repository with that name already exists.');
    } else {
      console.error('❌ Unexpected error:', err.message);
    }
  }
}

run();
