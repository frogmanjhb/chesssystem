const express = require('express')
const cors = require('cors')
const { v4: uuidv4 } = require('uuid')
const { createServer } = require('http')
const { Server } = require('socket.io')
const path = require('path')

const app = express()
const server = createServer(app)
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
})

// In-memory database
const inMemoryDB = {
  tournaments: [],
  players: [],
  rounds: [],
  pairings: []
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
app.get('/api/tournaments', (req, res) => {
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
})

// Create tournament
app.post('/api/tournaments', (req, res) => {
  const { name, maxRounds, timeControl } = req.body
  
  if (!name || !maxRounds || !timeControl) {
    return res.status(400).json({ message: 'Missing required fields' })
  }

  const tournament = {
    id: uuidv4(),
    name,
    maxRounds,
    timeControl,
    createdAt: new Date().toISOString()
  }

  inMemoryDB.tournaments.push(tournament)

  res.json({
    ...tournament,
    players: [],
    rounds: []
  })
})

// Get tournament details
app.get('/api/tournaments/:id', (req, res) => {
  const { id } = req.params
  const tournament = inMemoryDB.tournaments.find(t => t.id === id)
  
  if (!tournament) {
    return res.status(404).json({ message: 'Tournament not found' })
  }

  const players = inMemoryDB.players.filter(p => p.tournamentId === id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Join tournament
app.post('/api/tournaments/:id/join', (req, res) => {
  const { id } = req.params
  const { name, rating, email } = req.body

  if (!name || !rating) {
    return res.status(400).json({ message: 'Name and rating are required' })
  }

  const tournament = inMemoryDB.tournaments.find(t => t.id === id)
  if (!tournament) {
    return res.status(404).json({ message: 'Tournament not found' })
  }

  const player = {
    id: uuidv4(),
    tournamentId: id,
    name,
    rating,
    email,
    score: 0,
    createdAt: new Date().toISOString()
  }

  inMemoryDB.players.push(player)

  // Return updated tournament
  const players = inMemoryDB.players.filter(p => p.tournamentId === id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Add player to tournament
app.post('/api/tournaments/:id/players', (req, res) => {
  const { id } = req.params
  const { name, rating, email } = req.body

  if (!name || !rating) {
    return res.status(400).json({ message: 'Name and rating are required' })
  }

  const player = {
    id: uuidv4(),
    tournamentId: id,
    name,
    rating,
    email,
    score: 0,
    createdAt: new Date().toISOString()
  }

  inMemoryDB.players.push(player)

  // Return updated tournament
  const tournament = inMemoryDB.tournaments.find(t => t.id === id)
  const players = inMemoryDB.players.filter(p => p.tournamentId === id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Start new round
app.post('/api/tournaments/:id/rounds', (req, res) => {
  const { id } = req.params
  const { roundNumber, pairings } = req.body

  const round = {
    id: uuidv4(),
    tournamentId: id,
    roundNumber,
    createdAt: new Date().toISOString()
  }

  inMemoryDB.rounds.push(round)

  // Add pairings
  const newPairings = pairings.map(pairing => ({
    id: uuidv4(),
    roundId: round.id,
    white: pairing.white,
    black: pairing.black,
    whiteName: pairing.whiteName,
    blackName: pairing.blackName,
    result: pairing.result,
    createdAt: new Date().toISOString()
  }))

  inMemoryDB.pairings.push(...newPairings)

  // Return updated tournament
  const tournament = inMemoryDB.tournaments.find(t => t.id === id)
  const players = inMemoryDB.players.filter(p => p.tournamentId === id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Update pairing result
app.put('/api/tournaments/:id/pairings/:pairingId', (req, res) => {
  const { pairingId } = req.params
  const { result } = req.body

  const pairing = inMemoryDB.pairings.find(p => p.id === pairingId)
  if (pairing) {
    pairing.result = result
  }

  // Update player scores
  updatePlayerScores(req.params.id)

  // Return updated tournament
  const tournament = inMemoryDB.tournaments.find(t => t.id === req.params.id)
  const players = inMemoryDB.players.filter(p => p.tournamentId === req.params.id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === req.params.id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Helper function to update player scores
const updatePlayerScores = (tournamentId) => {
  const players = inMemoryDB.players.filter(p => p.tournamentId === tournamentId)
  
  players.forEach(player => {
    let score = 0
    const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === tournamentId)
    
    rounds.forEach(round => {
      const pairings = inMemoryDB.pairings.filter(p => p.roundId === round.id)
      pairings.forEach(pairing => {
        if (pairing.white === player.id) {
          if (pairing.result === '1-0') score += 1
          else if (pairing.result === '0.5-0.5') score += 0.5
        } else if (pairing.black === player.id) {
          if (pairing.result === '0-1') score += 1
          else if (pairing.result === '0.5-0.5') score += 0.5
        }
      })
    })
    
    player.score = score
  })
}

// Serve React app (only in production)
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
  })
}

const PORT = process.env.PORT || 5000

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📱 Frontend should be available at http://localhost:3000`)
  console.log(`🔧 Backend API available at http://localhost:${PORT}`)
})
