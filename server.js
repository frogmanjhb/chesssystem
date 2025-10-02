const express = require('express')
const cors = require('cors')
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
  tournaments: [],
  players: [],
  rounds: [],
  pairings: []
}

// Initialize database tables
const initDatabase = async () => {
  if (useInMemoryDB) {
    console.log('In-memory database initialized')
    return
  }

  try {
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

// API Routes

// Get all tournaments
app.get('/api/tournaments', async (req, res) => {
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
app.post('/api/tournaments', async (req, res) => {
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
app.get('/api/tournaments/:id', async (req, res) => {
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
app.post('/api/tournaments/:id/players', async (req, res) => {
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
app.post('/api/tournaments/:id/rounds', async (req, res) => {
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
app.put('/api/tournaments/:id/pairings/:pairingId', async (req, res) => {
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
