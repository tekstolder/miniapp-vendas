const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG = {
  vendasUrl: 'https://app.upseller.com/pt/analytics/store-sales',
  cookiesFile: './cookies.json'
};

function aguardarEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.on('line', () => {
      rl.close();
      resolve();
    });
  });
}

async function salvarSessao() {
  console.log('🔐 Iniciando processo de login e salvamento de sessão...');
  console.log(`📍 Navegando para: ${CONFIG.vendasUrl}\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo'
  });

  const page = await context.newPage();

  try {
    await page.goto(CONFIG.vendasUrl);
    
    console.log('⏳ Aguardando login...');
    console.log('📝 Complete o login no navegador que abriu');
    console.log('💡 Quando chegar na página de vendas, pressione ENTER aqui...\n');

    // Aguardar que o usuário pressione ENTER
    await aguardarEnter();

    // Verificar se está na página correta
    if (page.url().includes('login')) {
      throw new Error('Login não completado - URL ainda em /login');
    }

    console.log('\n⏳ Salvando cookies...');

    // Salvar cookies
    const cookies = await context.cookies();
    fs.writeFileSync(CONFIG.cookiesFile, JSON.stringify(cookies, null, 2));

    console.log('\n✅ Sessão salva com sucesso!');
    console.log(`📁 Arquivo: ${path.resolve(CONFIG.cookiesFile)}`);
    console.log(`🪟 Cookies salvos: ${cookies.length}`);
    console.log('\n🎯 Você pode agora executar: npm start');

  } catch (error) {
    console.error('\n❌ Erro ao salvar sessão:', error.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  salvarSessao();
}