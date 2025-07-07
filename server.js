require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const axios = require('axios');
const { Pool } = require('pg');
const query = 'SELECT * FROM usuarios WHERE email = $1';


// Inicializa o express antes de usar `app`
const app = express();
app.use(cors());
app.use(express.json());

// Configuração do banco
const isLocal = process.env.DATABASE_URL?.includes('localhost');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});




module.exports = pool;



module.exports = pool;




const TELEGRAM_TOKEN = '7669412380:AAHu_ZQ73LjwCGSwI17gyr6VI5s8okPg7Z8';
const TELEGRAM_CHAT_ID = '6970987616';

function enviarNotificacao(mensagem) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const data = {
    chat_id: TELEGRAM_CHAT_ID,
    text: mensagem,
  };

  axios.post(url, data).catch(err => {
    console.error('Erro ao enviar mensagem para o Telegram:', err.message);
  });
}

pool.connect()
  .then(async client => {
    console.log('Banco conectado com sucesso!');
    await client.query('SET search_path TO public'); // <- ESSA LINHA AQUI
    client.release();
  })
  .catch(err => {
    console.error('Erro ao conectar no banco:', err);
  });

// Cadastro
app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const userExists = await pool.query('SELECT * FROM public.usuarios WHERE username = $1', [username]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: 'Usuário já existe' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO public.usuarios (username, password, saldo) VALUES ($1, $2, $3)',
      [username, hashedPassword, 0]
    );

    res.json({ message: 'Cadastro realizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao registrar usuário:', err);
    res.status(500).json({ message: 'Erro no servidor' });
  }
});

console.log('Conectando ao banco com URL:', process.env.DATABASE_URL);

// Login
// Substitua no /login
// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;  // Agora estamos esperando o 'username'

  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);  // Usando 'username' na consulta

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Senha incorreta' });
    }

    res.json({
      message: 'Login bem-sucedido!',
      username: user.username, // Envia o 'username' ao invés de 'email'
      saldo: parseFloat(user.saldo),
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ message: 'Erro no servidor' });
  }
});


// Registrar depósito (pendente)
app.post('/depositar', async (req, res) => {
  const { username, valor } = req.body;

  if (!username || !valor || isNaN(valor)) {
    return res.status(400).json({ message: 'Dados inválidos.' });
  }

  try {
    await pool.query(
      'INSERT INTO extrato (username, tipo, valor, status) VALUES ($1, $2, $3, $4)',
      [username, 'depósito', valor, 'pendente']
    );

    // Aqui envia a notificação para o Telegram imediatamente após registrar o depósito
    enviarNotificacao(`💰 Novo depósito feito por ${username}: R$${valor}`);

    res.json({ message: 'Depósito registrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao registrar depósito:', err);
    res.status(500).json({ message: 'Erro no servidor' });
  }
});


// Confirmar depósito (admin)
app.post('/confirmar-deposito', async (req, res) => {
  const { username, valor } = req.body;

  try {
await pool.query('UPDATE public.usuarios SET saldo = saldo + $1 WHERE username = $2', [valor, username]);

    await pool.query(
      'UPDATE extrato SET status = $1 WHERE username = $2 AND valor = $3 AND tipo = $4 AND status = $5',
      ['confirmado', username, valor, 'depósito', 'pendente']
    );

    console.log('Enviando notificação para o Telegram...'); // Log para debug
    enviarNotificacao(`💰 Depósito confirmado para ${username}: R$${valor}`);

    res.json({ message: 'Depósito confirmado.' });
  } catch (err) {
    console.error('Erro ao confirmar depósito:', err);
    res.status(500).json({ message: 'Erro no servidor' });
  }
});


// Saldo
app.get('/saldo/:username', async (req, res) => {
  const { username } = req.params;

  try {
    const result = await pool.query(
      'SELECT saldo FROM usuarios WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json({ saldo: parseFloat(result.rows[0].saldo) });
  } catch (err) {
    console.error('Erro ao buscar saldo:', err);
    res.status(500).json({ message: 'Erro no servidor' });
  }
});

// Saque
app.post('/sacar', async (req, res) => {
  const { username, valor } = req.body;

 if (!username || isNaN(valor) || valor < 20) {
  return res.status(400).json({ message: 'O valor mínimo para saque é R$20,00.' });
}

  try {
    const result = await pool.query('SELECT saldo FROM public.usuarios WHERE username = $1', [username]);

await pool.query('UPDATE public.usuarios SET saldo = saldo - $1 WHERE username = $2', [valor, username]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const saldoAtual = parseFloat(result.rows[0].saldo);
    if (valor > saldoAtual) {
      return res.status(400).json({ message: 'Saldo insuficiente' });
    }

    await pool.query('UPDATE usuarios SET saldo = saldo - $1 WHERE username = $2', [valor, username]);
enviarNotificacao(`🏧 Saque solicitado por ${username}: R$${valor}`);

    await pool.query(
      'INSERT INTO extrato (username, tipo, valor) VALUES ($1, $2, $3)',
      [username, 'saque', valor]
    );

    res.json({ message: 'Saque realizado com sucesso' });
  } catch (err) {
    console.error('Erro no saque:', err);
    res.status(500).json({ message: 'Erro no servidor' });
  }
});

// Apostar
app.post('/apostar', async (req, res) => {
  const { username, partida, valor, odd, timeEscolhido } = req.body;
  try {
    // Buscar saldo do usuário
const resultSaldo = await pool.query('SELECT saldo FROM public.usuarios WHERE username = $1', [username]);
    // Somar apostas do usuário feitas hoje
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const amanha = new Date(hoje);
    amanha.setDate(hoje.getDate() + 1);

    const resultApostasHoje = await pool.query(
      `SELECT COALESCE(SUM(valor), 0) AS total
       FROM extrato
       WHERE username = $1
         AND tipo = 'aposta'
         AND data >= $2 AND data < $3`,
      [username, hoje, amanha]
    );

    const totalApostadoHoje = parseFloat(resultApostasHoje.rows[0].total);

    if (totalApostadoHoje + valor > 20) { // Corrigi para R$20 conforme pediu antes
      return res.status(400).json({ message: 'Limite diário de apostas de R$20,00 atingido.' });
    }

    // Deduz saldo e registra aposta
    await pool.query('UPDATE usuarios SET saldo = saldo - $1 WHERE username = $2', [valor, username]);
    await pool.query(
      'INSERT INTO extrato (username, tipo, valor, partida, odd) VALUES ($1, $2, $3, $4, $5)',
      [username, 'aposta', valor, partida, odd]
    );

    // Envia notificação para o Telegram
enviarNotificacao(`🎲 Nova aposta de ${username}: R$${valor} no time "${timeEscolhido}" na partida "${partida}" com odd ${odd}`);

    res.json({ message: 'Aposta registrada com sucesso!' });
  } catch (err) {
    console.error('Erro ao registrar aposta:', err);
    res.status(500).json({ message: 'Erro no servidor' });
  }
});


// Extrato
app.get('/extrato/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM extrato WHERE username = $1 ORDER BY data DESC',
      [username]
    );
    res.json({ extrato: result.rows });
  } catch (err) {
    console.error('Erro ao buscar extrato:', err);
    res.status(500).json({ message: 'Erro no servidor' });
  }
});
// Todas as suas rotas aqui (login, register, saldo, etc)

// Middleware de log
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Servir arquivos estáticos da pasta "public"
app.use(express.static('public'));

// Iniciar servidor
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

app.get('/debug/tabelas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});
app.get('/debug/tabelas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});
