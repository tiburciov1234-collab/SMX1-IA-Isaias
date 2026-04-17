const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const stripePackage = require('stripe');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
  console.warn('Advertencia: STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET deben configurarse en el archivo .env');
}

const stripe = stripePackage(STRIPE_SECRET_KEY);
const app = express();

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'database.db');
const db = new sqlite3.Database(dbPath, err => {
  if (err) {
    console.error('No se pudo abrir la base de datos:', err.message);
    process.exit(1);
  }
});

const runDb = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve(this);
  });
});
const getDb = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) return reject(err);
    resolve(row);
  });
});

async function initDb() {
  await runDb(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'free',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

initDb().catch(err => {
  console.error('Error inicializando la base de datos:', err);
  process.exit(1);
});

app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.originalUrl === '/webhook') {
      req.rawBody = buf;
    }
  }
}));
app.use(express.static(path.join(__dirname)));

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

async function getUserById(id) {
  return getDb('SELECT id, name, email, role FROM users WHERE id = ?', [id]);
}

const PROFILE_CATALOG = [
  { id: 1, name: 'Lucía', age: 26, distanceKm: 0.5, tags: ['Arte','Foodie','Viajes','Fotografía'], online: true },
  { id: 2, name: 'Emma', age: 24, distanceKm: 1.2, tags: ['Música','Gym','Libros','Teatro'], online: false },
  { id: 3, name: 'Sara', age: 27, distanceKm: 2.3, tags: ['Ciencia','Naturaleza','Perros','Running'], online: true },
  { id: 4, name: 'Luna', age: 22, distanceKm: 0.8, tags: ['Teatro','Yoga','Café','Mindfulness'], online: true },
  { id: 5, name: 'Carlos', age: 30, distanceKm: 1.5, tags: ['Fitness','Música','Viajes','Salud'], online: true },
  { id: 6, name: 'Miguel', age: 29, distanceKm: 2.0, tags: ['Fotografía','Arte','Viajes','Café'], online: false }
];

async function getUserByEmail(email) {
  return getDb('SELECT id, name, email, password_hash, role FROM users WHERE email = ?', [email]);
}

function premiumMiddleware(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Autenticación requerida.' });
  }
  if (req.user.role !== 'premium') {
    return res.status(403).json({ error: 'Acceso premium requerido.' });
  }
  next();
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticación faltante.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(payload.id);
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado.' });
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });
    }

    const existing = await getUserByEmail(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Ya existe un usuario con este email.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await runDb(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name || '', email.toLowerCase(), passwordHash, 'free']
    );

    const user = await getUserById(result.lastID);
    const token = signToken(user);
    return res.json({ token, user });
  } catch (error) {
    console.error('Error en /api/register', error);
    return res.status(500).json({ error: 'Error interno en el servidor.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });
    }

    const user = await getUserByEmail(email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    }

    const token = signToken(user);
    return res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    console.error('Error en /api/login', error);
    return res.status(500).json({ error: 'Error interno en el servidor.' });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  return res.json({ user: { ...req.user, isPremium: req.user.role === 'premium' } });
});

app.get('/api/premium-status', authMiddleware, async (req, res) => {
  return res.json({ isPremium: req.user.role === 'premium', role: req.user.role });
});

app.post('/api/premium-search', authMiddleware, premiumMiddleware, async (req, res) => {
  try {
    const {
      ageMin = 18,
      ageMax = 99,
      distanceMax = 50,
      interests = [],
      verifiedOnly = false,
      activeOnly = false
    } = req.body;

    const results = PROFILE_CATALOG.filter(profile => {
      if (profile.age < ageMin || profile.age > ageMax) return false;
      if (profile.distanceKm > distanceMax) return false;
      if (verifiedOnly && !profile.online) return false;
      if (activeOnly && !profile.online) return false;
      if (Array.isArray(interests) && interests.length > 0) {
        const hasInterest = interests.some(interest =>
          profile.tags.some(tag => tag.toLowerCase().includes(interest.toLowerCase()))
        );
        if (!hasInterest) return false;
      }
      return true;
    });

    return res.json({ results });
  } catch (error) {
    console.error('Error en /api/premium-search', error);
    return res.status(500).json({ error: 'No se pudo ejecutar la búsqueda premium.' });
  }
});

app.post('/api/create-checkout-session', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    const prices = {
      monthly: 999,
      yearly: 4999
    };

    if (!prices[plan]) {
      return res.status(400).json({ error: 'Plan de pago inválido.' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `Love Swipe Premium (${plan === 'yearly' ? 'Anual' : 'Mensual'})`,
              description: 'Acceso completo a funciones Premium en Love Swipe'
            },
            unit_amount: prices[plan]
          },
          quantity: 1
        }
      ],
      customer_email: req.user.email,
      metadata: {
        userId: String(req.user.id),
        plan
      },
      success_url: `${BASE_URL}/index.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/index.html?checkout=cancelled`
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error('Error en /api/create-checkout-session', error);
    return res.status(500).json({ error: 'No se pudo crear la sesión de pago.' });
  }
});

app.post('/webhook', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const rawBody = req.rawBody;

  if (!signature || !rawBody) {
    return res.status(400).send('Webhook inválido. Faltan datos.');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('Error validando webhook:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    if (userId) {
      try {
        await runDb('UPDATE users SET role = ? WHERE id = ?', ['premium', userId]);
        console.log(`Usuario ${userId} actualizado a premium.`);
      } catch (error) {
        console.error('Error actualizando rol premium:', error);
      }
    }
  }

  res.json({ received: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno en el servidor.' });
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
