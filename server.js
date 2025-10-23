// ============================================
// MINIAPP - COLETA DE VENDAS
// Server Express + Playwright
// ============================================

const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// -----------------------------------------------
// CONFIGURAÇÕES
// -----------------------------------------------
const CONFIG = {
  vendasUrl: 'https://app.upseller.com/pt/analytics/store-sales',
  cookiesFile: './cookies.json',
  outputDir: './dados_vendas',
  screenshotDir: './screenshots',
  historicoFile: './historico_vendas.json',
  headless: true,
  timeout: 60000,
  port: process.env.PORT || 3000,
  token: process.env.AUTH_TOKEN || 'seu-token-secreto-aqui'
};

// -----------------------------------------------
// MIDDLEWARE DE AUTENTICAÇÃO
// -----------------------------------------------
const autenticar = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1] || req.query.token;
  if (!token || token !== CONFIG.token) {
    return res.status(401).json({ erro: 'Token inválido', status: 'falha' });
  }
  next();
};

// -----------------------------------------------
// INICIALIZAR HISTÓRICO
// -----------------------------------------------
function inicializarHistorico() {
  if (!fs.existsSync(CONFIG.historicoFile)) {
    fs.writeFileSync(CONFIG.historicoFile, JSON.stringify({ coletas: [] }, null, 2));
  }
}

function salvarNoHistorico(dados) {
  const historico = JSON.parse(fs.readFileSync(CONFIG.historicoFile, 'utf-8'));
  historico.coletas.push({
    data: new Date().toISOString(),
    periodo: dados.periodo,
    totalPedidos: dados.pedidosValidos,
    totalValor: dados.valorVendasValidas,
    detalhes: dados.detalhes
  });
  
  // Manter apenas últimos 30 dias
  historico.coletas = historico.coletas.slice(-30);
  fs.writeFileSync(CONFIG.historicoFile, JSON.stringify(historico, null, 2));
}

function obterHistorico(dias = 7) {
  const historico = JSON.parse(fs.readFileSync(CONFIG.historicoFile, 'utf-8'));
  const agora = new Date();
  const dataLimite = new Date(agora.setDate(agora.getDate() - dias));
  
  return historico.coletas.filter(c => new Date(c.data) >= dataLimite);
}

// -----------------------------------------------
// COLETA DE VENDAS
// -----------------------------------------------
async function coletarVendas() {
  console.log('🚀 Iniciando coleta de vendas...');
  
  if (!fs.existsSync(CONFIG.cookiesFile)) {
    throw new Error('Arquivo de cookies não encontrado! Execute salvar-sessao.js primeiro');
  }

  criarDiretorios();
  const browser = await chromium.launch({ headless: CONFIG.headless });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo'
  });

  const page = await context.newPage();

  try {
    // 1. CARREGAR COOKIES
    const cookiesData = fs.readFileSync(CONFIG.cookiesFile, 'utf-8');
    const cookies = JSON.parse(cookiesData);
    await context.addCookies(cookies);

    // 2. NAVEGAR
    await page.goto(CONFIG.vendasUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
    await page.waitForTimeout(3000);

    // 3. VERIFICAR LOGIN
    if (page.url().includes('login')) {
      throw new Error('Sessão expirada - execute salvar-sessao.js novamente');
    }

    // 4. AGUARDAR DATE PICKER
    await page.waitForSelector('.ant-calendar-picker', { state: 'visible', timeout: 30000 });

    // 5. SELECIONAR PERÍODO (ONTEM)
    await selecionarPeriodo(page, 'ontem');
    await page.waitForTimeout(1000);

    // 6. CLICAR EM POR LOJA
    await page.click('text=Por Loja');
    await page.waitForTimeout(2000);

    // 7. AGUARDAR DADOS
    await aguardarDados(page);

    // 8. EXTRAIR DADOS
    const dados = await extrairDados(page);

    // 9. SALVAR NO HISTÓRICO
    salvarNoHistorico(dados);

    // 10. SCREENSHOT
    await page.screenshot({ 
      path: path.join(CONFIG.screenshotDir, `sucesso_${getDataHora()}.png`), 
      fullPage: true 
    });

    console.log('✅ Coleta finalizada com sucesso');
    return { status: 'sucesso', dados };

  } catch (error) {
    console.error('❌ Erro na coleta:', error.message);
    try {
      await page.screenshot({ 
        path: path.join(CONFIG.screenshotDir, `erro_${getDataHora()}.png`), 
        fullPage: true 
      });
    } catch (e) {}
    throw error;
  } finally {
    await browser.close();
  }
}

// -----------------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------------
async function selecionarPeriodo(page, periodo = 'ontem') {
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  
  const mesmoMes = hoje.getMonth() === ontem.getMonth() && hoje.getFullYear() === ontem.getFullYear();
  
  if (mesmoMes) {
    await page.click('text=Este mês');
  } else {
    await page.click('text=Últimos 30 dias');
  }
  await page.waitForTimeout(2000);
  
  await page.click('.ant-calendar-picker');
  await page.waitForSelector('.ant-calendar-range', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(800);
  
  const ontemDia = ontem.getDate();
  const painelEsquerdo = await page.$('.ant-calendar-range-left');
  const celulas = await painelEsquerdo.$$('.ant-calendar-date');
  
  for (const celula of celulas) {
    const texto = await celula.textContent();
    const classes = await celula.getAttribute('class');
    
    if (texto.trim() === String(ontemDia) &&
        !classes.includes('ant-calendar-last-month-cell') &&
        !classes.includes('ant-calendar-next-month-cell')) {
      await celula.click();
      await page.waitForTimeout(300);
      await celula.click();
      break;
    }
  }
}

async function aguardarDados(page) {
  try {
    await page.waitForSelector('.ant-spin', { state: 'hidden', timeout: 10000 });
  } catch (e) {}
  await page.waitForTimeout(3000);
}

async function extrairDados(page) {
  const dados = await page.evaluate(() => {
    const limparNumero = texto => {
      if (!texto) return 0;
      return parseFloat(texto.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
    };
    
    const inputs = document.querySelectorAll('.ant-calendar-range-picker-input');
    const periodo = inputs.length === 2
      ? `${inputs[0].value} ~ ${inputs[1].value}`
      : 'Não definido';
    
    const tabelaLinhas = [];
    const tabela = document.querySelector('table');
    
    if (tabela) {
      const linhas = tabela.querySelectorAll('tbody tr');
      linhas.forEach(linha => {
        const colunas = linha.querySelectorAll('td');
        if (colunas.length > 0) {
          tabelaLinhas.push({
            loja: colunas[0]?.textContent.trim() || '',
            marketplace: colunas[1]?.textContent.trim() || '',
            totalPedidos: parseInt(colunas[2]?.textContent.trim()) || 0,
            valorTotal: limparNumero(colunas[3]?.textContent),
            pedidosValidos: parseInt(colunas[4]?.textContent.trim()) || 0,
            valorVendasValidas: limparNumero(colunas[5]?.textContent),
            pedidosCancelados: parseInt(colunas[6]?.textContent.trim()) || 0,
            valorVendasCanceladas: limparNumero(colunas[7]?.textContent),
            clientes: parseInt(colunas[8]?.textContent.trim()) || 0,
            vendasPorCliente: limparNumero(colunas[9]?.textContent)
          });
        }
      });
    }
    
    const totalPedidos = tabelaLinhas.reduce((sum, l) => sum + l.pedidosValidos, 0);
    const totalValor = tabelaLinhas.reduce((sum, l) => sum + l.valorVendasValidas, 0);
    
    return {
      periodo,
      detalhes: tabelaLinhas,
      pedidosValidos: totalPedidos,
      valorVendasValidas: totalValor
    };
  });
  
  return dados;
}

function criarDiretorios() {
  [CONFIG.outputDir, CONFIG.screenshotDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

function getDataHora() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

// -----------------------------------------------
// ENDPOINTS
// -----------------------------------------------

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// Disparar coleta
app.post('/api/coleta', autenticar, async (req, res) => {
  try {
    const resultado = await coletarVendas();
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: 'falha',
      erro: error.message
    });
  }
});

// Obter últimos dados
app.get('/api/dados', autenticar, (req, res) => {
  try {
    const historico = JSON.parse(fs.readFileSync(CONFIG.historicoFile, 'utf-8'));
    const ultimosDados = historico.coletas[historico.coletas.length - 1];
    
    if (!ultimosDados) {
      return res.status(404).json({ status: 'falha', erro: 'Nenhuma coleta realizada ainda' });
    }
    
    res.json({
      status: 'sucesso',
      dados: ultimosDados
    });
  } catch (error) {
    res.status(500).json({ status: 'falha', erro: error.message });
  }
});

// Obter histórico para análise (7 dias)
app.get('/api/historico', autenticar, (req, res) => {
  try {
    const dias = parseInt(req.query.dias) || 7;
    const historico = obterHistorico(dias);
    
    const media = historico.reduce((sum, c) => sum + c.totalValor, 0) / (historico.length || 1);
    
    res.json({
      status: 'sucesso',
      dias,
      coletas: historico.length,
      media,
      dados: historico
    });
  } catch (error) {
    res.status(500).json({ status: 'falha', erro: error.message });
  }
});

// -----------------------------------------------
// INICIAR SERVIDOR
// -----------------------------------------------
inicializarHistorico();
criarDiretorios();

app.listen(CONFIG.port, () => {
  console.log(`
╔════════════════════════════════════════╗
║     🚀 MINIAPP VENDAS INICIADO        ║
╠════════════════════════════════════════╣
║ 🌐 Server: http://localhost:${CONFIG.port}
║ 📍 Health: GET /health
║ 💾 Coleta: POST /api/coleta
║ 📊 Dados: GET /api/dados
║ 📈 Histórico: GET /api/historico
║ 🔐 Token: Usar header Authorization
╚════════════════════════════════════════╝
  `);
});

module.exports = app;