#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('Gmail MCP Server Setup\n');

async function setup() {
  // Check if credentials.json exists
  const credentialsPath = path.join(__dirname, '..', 'credentials.json');
  if (!fs.existsSync(credentialsPath)) {
    console.log('⚠️  credentials.json not found!');
    console.log('\nPlease follow these steps:');
    console.log('1. Go to https://console.cloud.google.com');
    console.log('2. Create a new project or select an existing one');
    console.log('3. Enable the Gmail API');
    console.log('4. Create OAuth2 credentials (Desktop application type)');
    console.log('5. Download the credentials and save as credentials.json in the project root\n');
    
    await new Promise(resolve => {
      rl.question('Press Enter when you have placed credentials.json in the project root...', resolve);
    });
    
    if (!fs.existsSync(credentialsPath)) {
      console.log('\n❌ credentials.json still not found. Please complete the setup and try again.');
      process.exit(1);
    }
  }
  
  console.log('✅ credentials.json found\n');

  // Check if .env exists
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.log('Creating .env file from template...');
    const envExamplePath = path.join(__dirname, '..', '.env.example');
    fs.copyFileSync(envExamplePath, envPath);
    console.log('✅ .env file created\n');
  } else {
    console.log('✅ .env file exists\n');
  }

  // Create necessary directories
  const directories = ['data', 'logs', 'archives'];
  for (const dir of directories) {
    const dirPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`✅ Created ${dir}/ directory`);
    }
  }

  console.log('\n🎉 Setup complete!\n');
  console.log('Next steps:');
  console.log('1. Run: npm install');
  console.log('2. Run: npm run build');
  console.log('3. Configure your MCP client to use this server');
  console.log('4. Use the "authenticate" tool to connect your Gmail account\n');

  rl.close();
}

setup().catch(error => {
  console.error('Setup error:', error);
  process.exit(1);
});