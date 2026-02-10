const express = require('express')
const cors = require('cors')
const path = require('path')
const { Pool } = require('pg')
const { v4: uuidv4 } = require('uuid')
const { createServer } = require('http')
const { Server } = require('socket.io')

const app = express()
const server = createServer(app)
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
})

// Database connection (Railway Postgres)
let pool
let useInMemoryDB = false

if (process.env.DATABASE_URL) {
  // Use PostgreSQL in production
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  })
} else {
  // Use in-memory database for local development
  useInMemoryDB = true
  console.log('Using in-memory database for local development')
}

// In-memory database for local development
const inMemoryDB = {
  users: [],
  tournaments: [],
  players: [],
  rounds: [],
  pairings: []
}

// Simple password hashing (in production, use bcrypt)
const hashPassword = (password) => {
  return Buffer.from(password).toString('base64')
}

// Simple password verification
const verifyPassword = (password, hash) => {
  return hashPassword(password) === hash
}

// Generate JWT-like token (simplified for demo)
const generateToken = (userId) => {
  return Buffer.from(JSON.stringify({ userId, timestamp: Date.now() })).toString('base64')
}

// Verify token
const verifyToken = (token) => {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString())
    return decoded.userId
  } catch {
    return null
  }
}

// Middleware to check authentication
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }

  const userId = verifyToken(token)
  if (!userId) {
    return res.status(403).json({ error: 'Invalid token' })
  }

  if (useInMemoryDB) {
    const user = inMemoryDB.users.find(u => u.id === userId)
    if (!user) {
      return res.status(403).json({ error: 'User not found' })
    }
    req.user = user
  } else {
    // For PostgreSQL, we'll need to fetch user from database
    // For now, just set userId
    req.user = { id: userId }
  }
  
  next()
}

// Initialize database tables
const initDatabase = async () => {
  if (useInMemoryDB) {
    console.log('In-memory database initialized')
    return
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tournaments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        max_rounds INTEGER NOT NULL,
        time_control VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        rating INTEGER NOT NULL,
        email VARCHAR(255),
        score DECIMAL(3,1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rounds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
        round_number INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS pairings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        round_id UUID REFERENCES rounds(id) ON DELETE CASCADE,
        white_player_id UUID REFERENCES players(id) ON DELETE CASCADE,
        black_player_id UUID REFERENCES players(id) ON DELETE CASCADE,
        result VARCHAR(10),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    console.log('Database initialized successfully')
  } catch (error) {
    console.error('Error initializing database:', error)
  }
}

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static('dist'))

// Authentication routes
app.post('/api/auth/register', async (req, res) => {
  const { firstName, lastName, email, password } = req.body

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' })
  }

  // Validate email domain
  if (!email.toLowerCase().endsWith('@stpeters.co.za')) {
    return res.status(400).json({ error: 'Only @stpeters.co.za email addresses are allowed to register' })
  }

  try {
    if (useInMemoryDB) {
      // Check if user already exists
      const existingUser = inMemoryDB.users.find(u => u.email === email)
      if (existingUser) {
        return res.status(400).json({ error: 'User with this email already exists' })
      }

      // Create new user
      const user = {
        id: uuidv4(),
        firstName,
        lastName,
        email,
        password: hashPassword(password),
        createdAt: new Date().toISOString()
      }

      inMemoryDB.users.push(user)

      // Generate token
      const token = generateToken(user.id)

      res.json({
        message: 'User registered successfully',
        token,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        }
      })
    } else {
      // PostgreSQL implementation
      const hashedPassword = hashPassword(password)
      
      const result = await pool.query(`
        INSERT INTO users (first_name, last_name, email, password)
        VALUES ($1, $2, $3, $4)
        RETURNING id, first_name, last_name, email, created_at
      `, [firstName, lastName, email, hashedPassword])

      const user = result.rows[0]
      const token = generateToken(user.id)

      res.json({
        message: 'User registered successfully',
        token,
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email
        }
      })
    }
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ error: 'User with this email already exists' })
    }
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  try {
    if (useInMemoryDB) {
      // Find user
      const user = inMemoryDB.users.find(u => u.email === email)
      if (!user || !verifyPassword(password, user.password)) {
        return res.status(401).json({ error: 'Invalid email or password' })
      }

      // Generate token
      const token = generateToken(user.id)

      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        }
      })
    } else {
      // PostgreSQL implementation
      const result = await pool.query(`
        SELECT id, first_name, last_name, email, password
        FROM users WHERE email = $1
      `, [email])

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' })
      }

      const user = result.rows[0]
      if (!verifyPassword(password, user.password)) {
        return res.status(401).json({ error: 'Invalid email or password' })
      }

      // Generate token
      const token = generateToken(user.id)

      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email
        }
      })
    }
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    if (useInMemoryDB) {
      res.json({
        user: {
          id: req.user.id,
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          email: req.user.email
        }
      })
    } else {
      // For PostgreSQL, fetch user details
      const result = await pool.query(`
        SELECT id, first_name, last_name, email
        FROM users WHERE id = $1
      `, [req.user.id])

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' })
      }

      const user = result.rows[0]
      res.json({
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email
        }
      })
    }
  } catch (error) {
    console.error('Auth me error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id)

  socket.on('joinTournament', (tournamentId) => {
    socket.join(`tournament-${tournamentId}`)
    console.log(`User ${socket.id} joined tournament ${tournamentId}`)
  })

  socket.on('tournamentUpdate', (tournamentId) => {
    socket.to(`tournament-${tournamentId}`).emit('tournamentUpdated', { tournamentId })
  })

  socket.on('roundUpdate', (tournamentId) => {
    socket.to(`tournament-${tournamentId}`).emit('roundUpdated', { tournamentId })
  })

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id)
  })
})

// API Routes (all protected with authentication)

// Get all tournaments
app.get('/api/tournaments', authenticateToken, async (req, res) => {
  try {
    if (useInMemoryDB) {
      const tournaments = inMemoryDB.tournaments.map(tournament => ({
        id: tournament.id,
        name: tournament.name,
        maxRounds: tournament.maxRounds,
        timeControl: tournament.timeControl,
        playerCount: inMemoryDB.players.filter(p => p.tournamentId === tournament.id).length,
        roundCount: inMemoryDB.rounds.filter(r => r.tournamentId === tournament.id).length,
        createdAt: tournament.createdAt
      }))
      res.json(tournaments)
      return
    }

    const result = await pool.query(`
      SELECT t.*, 
             COUNT(p.id) as player_count,
             COUNT(r.id) as round_count
      FROM tournaments t
      LEFT JOIN players p ON t.id = p.tournament_id
      LEFT JOIN rounds r ON t.id = r.tournament_id
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `)
    
    const tournaments = result.rows.map(tournament => ({
      id: tournament.id,
      name: tournament.name,
      maxRounds: tournament.max_rounds,
      timeControl: tournament.time_control,
      playerCount: parseInt(tournament.player_count),
      roundCount: parseInt(tournament.round_count),
      createdAt: tournament.created_at
    }))

    res.json(tournaments)
  } catch (error) {
    console.error('Error fetching tournaments:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// Create tournament
app.post('/api/tournaments', authenticateToken, async (req, res) => {
  try {
    const { name, maxRounds, timeControl } = req.body
    
    if (!name || !maxRounds || !timeControl) {
      return res.status(400).json({ message: 'Missing required fields' })
    }

    const result = await pool.query(`
      INSERT INTO tournaments (name, max_rounds, time_control)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [name, maxRounds, timeControl])

    const tournament = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      maxRounds: result.rows[0].max_rounds,
      timeControl: result.rows[0].time_control,
      players: [],
      rounds: [],
      createdAt: result.rows[0].created_at
    }

    res.json(tournament)
  } catch (error) {
    console.error('Error creating tournament:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// Get tournament details
app.get('/api/tournaments/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Get tournament info
    const tournamentResult = await pool.query(`
      SELECT * FROM tournaments WHERE id = $1
    `, [id])

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Tournament not found' })
    }

    const tournament = tournamentResult.rows[0]

    // Get players
    const playersResult = await pool.query(`
      SELECT * FROM players WHERE tournament_id = $1 ORDER BY rating DESC
    `, [id])

    const players = playersResult.rows.map(player => ({
      id: player.id,
      name: player.name,
      rating: player.rating,
      email: player.email,
      score: parseFloat(player.score)
    }))

    // Get rounds with pairings
    const roundsResult = await pool.query(`
      SELECT r.*, 
             p.id as pairing_id,
             p.white_player_id,
             p.black_player_id,
             p.result,
             w.name as white_name,
             b.name as black_name
      FROM rounds r
      LEFT JOIN pairings p ON r.id = p.round_id
      LEFT JOIN players w ON p.white_player_id = w.id
      LEFT JOIN players b ON p.black_player_id = b.id
      WHERE r.tournament_id = $1
      ORDER BY r.round_number, p.created_at
    `, [id])

    const roundsMap = new Map()
    roundsResult.rows.forEach(row => {
      if (!roundsMap.has(row.id)) {
        roundsMap.set(row.id, {
          id: row.id,
          roundNumber: row.round_number,
          pairings: [],
          createdAt: row.created_at
        })
      }

      if (row.pairing_id) {
        roundsMap.get(row.id).pairings.push({
          id: row.pairing_id,
          white: row.white_player_id,
          black: row.black_player_id,
          whiteName: row.white_name,
          blackName: row.black_name,
          result: row.result,
          round: row.round_number
        })
      }
    })

    const rounds = Array.from(roundsMap.values())

    const fullTournament = {
      id: tournament.id,
      name: tournament.name,
      maxRounds: tournament.max_rounds,
      timeControl: tournament.time_control,
      players,
      rounds,
      createdAt: tournament.created_at
    }

    res.json(fullTournament)
  } catch (error) {
    console.error('Error fetching tournament:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// Join tournament
app.post('/api/tournaments/:id/join', async (req, res) => {
  try {
    const { id } = req.params
    const { name, rating, email } = req.body

    if (!name || !rating) {
      return res.status(400).json({ message: 'Name and rating are required' })
    }

    // Check if tournament exists
    const tournamentResult = await pool.query(`
      SELECT * FROM tournaments WHERE id = $1
    `, [id])

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Tournament not found' })
    }

    // Add player
    const playerResult = await pool.query(`
      INSERT INTO players (tournament_id, name, rating, email)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [id, name, rating, email])

    // Get updated tournament
    const updatedTournament = await getTournamentDetails(id)
    res.json(updatedTournament)
  } catch (error) {
    console.error('Error joining tournament:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// Add player to tournament
app.post('/api/tournaments/:id/players', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { name, rating, email } = req.body

    if (!name || !rating) {
      return res.status(400).json({ message: 'Name and rating are required' })
    }

    const playerResult = await pool.query(`
      INSERT INTO players (tournament_id, name, rating, email)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [id, name, rating, email])

    const updatedTournament = await getTournamentDetails(id)
    res.json(updatedTournament)
  } catch (error) {
    console.error('Error adding player:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// Start new round
app.post('/api/tournaments/:id/rounds', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { roundNumber, pairings } = req.body

    // Create round
    const roundResult = await pool.query(`
      INSERT INTO rounds (tournament_id, round_number)
      VALUES ($1, $2)
      RETURNING *
    `, [id, roundNumber])

    const roundId = roundResult.rows[0].id

    // Create pairings
    for (const pairing of pairings) {
      await pool.query(`
        INSERT INTO pairings (round_id, white_player_id, black_player_id, result)
        VALUES ($1, $2, $3, $4)
      `, [roundId, pairing.white, pairing.black, pairing.result])
    }

    const updatedTournament = await getTournamentDetails(id)
    res.json(updatedTournament)
  } catch (error) {
    console.error('Error starting round:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// Update pairing result
app.put('/api/tournaments/:id/pairings/:pairingId', authenticateToken, async (req, res) => {
  try {
    const { pairingId } = req.params
    const { result } = req.body

    await pool.query(`
      UPDATE pairings SET result = $1 WHERE id = $2
    `, [result, pairingId])

    // Update player scores
    await updatePlayerScores(req.params.id)

    const updatedTournament = await getTournamentDetails(req.params.id)
    res.json(updatedTournament)
  } catch (error) {
    console.error('Error updating pairing:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// Delete player
app.delete('/api/tournaments/:id/players/:playerId', authenticateToken, async (req, res) => {
  try {
    const { playerId } = req.params
    
    await pool.query(`
      DELETE FROM players WHERE id = $1
    `, [playerId])

    // Remove all pairings involving this player
    await pool.query(`
      DELETE FROM pairings WHERE white_player_id = $1 OR black_player_id = $1
    `, [playerId])

    const updatedTournament = await getTournamentDetails(req.params.id)
    res.json(updatedTournament)
  } catch (error) {
    console.error('Error deleting player:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// Update player
app.put('/api/tournaments/:id/players/:playerId', authenticateToken, async (req, res) => {
  try {
    const { playerId } = req.params
    const { name, rating, disabled } = req.body

    if (name || rating !== undefined) {
      await pool.query(`
        UPDATE players SET name = COALESCE($1, name), rating = COALESCE($2, rating)
        WHERE id = $3
      `, [name, rating, playerId])
    }

    const updatedTournament = await getTournamentDetails(req.params.id)
    res.json(updatedTournament)
  } catch (error) {
    console.error('Error updating player:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// Delete round
app.delete('/api/tournaments/:id/rounds/:roundId', authenticateToken, async (req, res) => {
  try {
    const { roundId } = req.params
    
    // Delete all pairings for this round first
    await pool.query(`
      DELETE FROM pairings WHERE round_id = $1
    `, [roundId])

    // Delete the round
    await pool.query(`
      DELETE FROM rounds WHERE id = $1
    `, [roundId])

    // Update player scores
    await updatePlayerScores(req.params.id)

    const updatedTournament = await getTournamentDetails(req.params.id)
    res.json(updatedTournament)
  } catch (error) {
    console.error('Error deleting round:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// Helper function to get tournament details
const getTournamentDetails = async (tournamentId) => {
  const tournamentResult = await pool.query(`
    SELECT * FROM tournaments WHERE id = $1
  `, [tournamentId])

  const tournament = tournamentResult.rows[0]

  const playersResult = await pool.query(`
    SELECT * FROM players WHERE tournament_id = $1 ORDER BY rating DESC
  `, [tournamentId])

  const players = playersResult.rows.map(player => ({
    id: player.id,
    name: player.name,
    rating: player.rating,
    email: player.email,
    score: parseFloat(player.score)
  }))

  const roundsResult = await pool.query(`
    SELECT r.*, 
           p.id as pairing_id,
           p.white_player_id,
           p.black_player_id,
           p.result,
           w.name as white_name,
           b.name as black_name
    FROM rounds r
    LEFT JOIN pairings p ON r.id = p.round_id
    LEFT JOIN players w ON p.white_player_id = w.id
    LEFT JOIN players b ON p.black_player_id = b.id
    WHERE r.tournament_id = $1
    ORDER BY r.round_number, p.created_at
  `, [tournamentId])

  const roundsMap = new Map()
  roundsResult.rows.forEach(row => {
    if (!roundsMap.has(row.id)) {
      roundsMap.set(row.id, {
        id: row.id,
        roundNumber: row.round_number,
        pairings: [],
        createdAt: row.created_at
      })
    }

    if (row.pairing_id) {
      roundsMap.get(row.id).pairings.push({
        id: row.pairing_id,
        white: row.white_player_id,
        black: row.black_player_id,
        whiteName: row.white_name,
        blackName: row.black_name,
        result: row.result,
        round: row.round_number
      })
    }
  })

  const rounds = Array.from(roundsMap.values())

  return {
    id: tournament.id,
    name: tournament.name,
    maxRounds: tournament.max_rounds,
    timeControl: tournament.time_control,
    players,
    rounds,
    createdAt: tournament.created_at
  }
}

// Helper function to update player scores
const updatePlayerScores = async (tournamentId) => {
  const playersResult = await pool.query(`
    SELECT id FROM players WHERE tournament_id = $1
  `, [tournamentId])

  for (const player of playersResult.rows) {
    const scoreResult = await pool.query(`
      SELECT 
        SUM(CASE 
          WHEN p.white_player_id = $1 AND p.result = '1-0' THEN 1
          WHEN p.black_player_id = $1 AND p.result = '0-1' THEN 1
          WHEN p.white_player_id = $1 AND p.result = '0.5-0.5' THEN 0.5
          WHEN p.black_player_id = $1 AND p.result = '0.5-0.5' THEN 0.5
          ELSE 0
        END) as total_score
      FROM pairings p
      JOIN rounds r ON p.round_id = r.id
      WHERE r.tournament_id = $2 AND p.result IS NOT NULL
    `, [player.id, tournamentId])

    const score = parseFloat(scoreResult.rows[0].total_score) || 0

    await pool.query(`
      UPDATE players SET score = $1 WHERE id = $2
    `, [score, player.id])
  }
}

// Serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

const PORT = process.env.PORT || 5000

// Initialize database and start server
initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
}).catch(error => {
  console.error('Failed to start server:', error)
})
