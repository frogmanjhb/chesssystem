import React, { useState, useEffect, useCallback } from 'react'
import io from 'socket.io-client'
import './App.css'

// Note: Database connection is handled in server.js

// Socket connection
const socket = io(process.env.REACT_APP_SERVER_URL || 'http://localhost:5000')

const App = () => {
  // State management
  const [tournaments, setTournaments] = useState([])
  const [currentTournament, setCurrentTournament] = useState(null)
  const [players, setPlayers] = useState([])
  const [rounds, setRounds] = useState([])
  const [currentRound, setCurrentRound] = useState(null)
  const [view, setView] = useState('home') // home, tournament, create, join
  const [newTournament, setNewTournament] = useState({
    name: '',
    maxRounds: 5,
    timeControl: '30+0'
  })
  const [newPlayer, setNewPlayer] = useState({
    name: '',
    rating: 1200,
    email: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Swiss System pairing algorithm
  const calculateSwissPairings = useCallback((players, roundNumber) => {
    if (players.length < 2) return []

    // Sort players by score (descending), then by rating (descending)
    const sortedPlayers = [...players].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.rating - a.rating
    })

    const pairings = []
    const used = new Set()

    for (let i = 0; i < sortedPlayers.length; i++) {
      if (used.has(i)) continue

      const player1 = sortedPlayers[i]
      let bestOpponent = null
      let bestOpponentIndex = -1
      let minScoreDiff = Infinity

      // Find best opponent (similar score, haven't played before)
      for (let j = i + 1; j < sortedPlayers.length; j++) {
        if (used.has(j)) continue

        const player2 = sortedPlayers[j]
        const scoreDiff = Math.abs(player1.score - player2.score)
        const havePlayed = rounds.some(round => 
          round.pairings.some(pairing => 
            (pairing.white === player1.id && pairing.black === player2.id) ||
            (pairing.white === player2.id && pairing.black === player1.id)
          )
        )

        if (!havePlayed && scoreDiff <= minScoreDiff) {
          minScoreDiff = scoreDiff
          bestOpponent = player2
          bestOpponentIndex = j
        }
      }

      if (bestOpponent) {
        pairings.push({
          id: `pairing-${Date.now()}-${Math.random()}`,
          white: player1.id,
          black: bestOpponent.id,
          whiteName: player1.name,
          blackName: bestOpponent.name,
          result: null,
          round: roundNumber
        })
        used.add(i)
        used.add(bestOpponentIndex)
      } else {
        // Bye for odd player
        pairings.push({
          id: `bye-${Date.now()}-${Math.random()}`,
          white: player1.id,
          black: null,
          whiteName: player1.name,
          blackName: 'BYE',
          result: '1-0',
          round: roundNumber
        })
        used.add(i)
      }
    }

    return pairings
  }, [rounds])

  // Load tournaments on mount
  useEffect(() => {
    loadTournaments()
    
    // Socket listeners
    socket.on('tournamentUpdated', (tournament) => {
      setCurrentTournament(tournament)
      if (tournament) {
        setPlayers(tournament.players || [])
        setRounds(tournament.rounds || [])
      }
    })

    socket.on('roundUpdated', (round) => {
      setCurrentRound(round)
    })

    return () => {
      socket.off('tournamentUpdated')
      socket.off('roundUpdated')
    }
  }, [])

  // API calls
  const loadTournaments = async () => {
    try {
      const response = await fetch('/api/tournaments')
      const data = await response.json()
      setTournaments(data)
    } catch (err) {
      setError('Failed to load tournaments')
    }
  }

  const createTournament = async () => {
    if (!newTournament.name.trim()) {
      setError('Tournament name is required')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTournament)
      })
      
      if (response.ok) {
        const tournament = await response.json()
        setCurrentTournament(tournament)
        setView('tournament')
        setSuccess('Tournament created successfully!')
        socket.emit('joinTournament', tournament.id)
      } else {
        const error = await response.json()
        setError(error.message)
      }
    } catch (err) {
      setError('Failed to create tournament')
    } finally {
      setLoading(false)
    }
  }

  const joinTournament = async (tournamentId) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPlayer)
      })
      
      if (response.ok) {
        const tournament = await response.json()
        setCurrentTournament(tournament)
        setPlayers(tournament.players || [])
        setRounds(tournament.rounds || [])
        setView('tournament')
        setSuccess('Joined tournament successfully!')
        socket.emit('joinTournament', tournamentId)
      } else {
        const error = await response.json()
        setError(error.message)
      }
    } catch (err) {
      setError('Failed to join tournament')
    } finally {
      setLoading(false)
    }
  }

  const addPlayer = async () => {
    if (!newPlayer.name.trim()) {
      setError('Player name is required')
      return
    }

    try {
      const response = await fetch(`/api/tournaments/${currentTournament.id}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPlayer)
      })
      
      if (response.ok) {
        const tournament = await response.json()
        setCurrentTournament(tournament)
        setPlayers(tournament.players || [])
        setNewPlayer({ name: '', rating: 1200, email: '' })
        setSuccess('Player added successfully!')
        socket.emit('tournamentUpdate', currentTournament.id)
      } else {
        const error = await response.json()
        setError(error.message)
      }
    } catch (err) {
      setError('Failed to add player')
    }
  }

  const startNextRound = async () => {
    if (players.length < 2) {
      setError('Need at least 2 players to start a round')
      return
    }

    const roundNumber = rounds.length + 1
    const pairings = calculateSwissPairings(players, roundNumber)

    try {
      const response = await fetch(`/api/tournaments/${currentTournament.id}/rounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundNumber, pairings })
      })
      
      if (response.ok) {
        const tournament = await response.json()
        setCurrentTournament(tournament)
        setRounds(tournament.rounds || [])
        setCurrentRound(tournament.rounds[tournament.rounds.length - 1])
        setSuccess(`Round ${roundNumber} started!`)
        socket.emit('roundUpdate', currentTournament.id)
      } else {
        const error = await response.json()
        setError(error.message)
      }
    } catch (err) {
      setError('Failed to start round')
    }
  }

  const updatePairingResult = async (pairingId, result) => {
    try {
      const response = await fetch(`/api/tournaments/${currentTournament.id}/pairings/${pairingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result })
      })
      
      if (response.ok) {
        const tournament = await response.json()
        setCurrentTournament(tournament)
        setPlayers(tournament.players || [])
        setRounds(tournament.rounds || [])
        setSuccess('Result updated!')
        socket.emit('tournamentUpdate', currentTournament.id)
      } else {
        const error = await response.json()
        setError(error.message)
      }
    } catch (err) {
      setError('Failed to update result')
    }
  }

  const getPlayerScore = (playerId) => {
    let score = 0
    rounds.forEach(round => {
      round.pairings.forEach(pairing => {
        if (pairing.white === playerId) {
          if (pairing.result === '1-0') score += 1
          else if (pairing.result === '0.5-0.5') score += 0.5
        } else if (pairing.black === playerId) {
          if (pairing.result === '0-1') score += 1
          else if (pairing.result === '0.5-0.5') score += 0.5
        }
      })
    })
    return score
  }

  const getStandings = () => {
    return players.map(player => ({
      ...player,
      score: getPlayerScore(player.id),
      gamesPlayed: rounds.reduce((count, round) => 
        count + round.pairings.filter(pairing => 
          pairing.white === player.id || pairing.black === player.id
        ).length, 0
      )
    })).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.rating - a.rating
    })
  }

  // Clear messages after 3 seconds
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError('')
        setSuccess('')
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [error, success])

  return (
    <div className="app">
      <header className="app-header">
        <h1>♔ Chess Tournament Manager</h1>
        <nav className="nav">
          <button 
            className={view === 'home' ? 'active' : ''} 
            onClick={() => setView('home')}
          >
            Home
          </button>
          {currentTournament && (
            <button 
              className={view === 'tournament' ? 'active' : ''} 
              onClick={() => setView('tournament')}
            >
              Tournament
            </button>
          )}
        </nav>
      </header>

      <main className="main-content">
        {error && <div className="alert error">{error}</div>}
        {success && <div className="alert success">{success}</div>}

        {view === 'home' && (
          <div className="home-view">
            <div className="welcome-section">
              <h2>Welcome to Chess Tournament Manager</h2>
              <p>Create or join a Swiss System chess tournament and manage it in real-time!</p>
            </div>

            <div className="action-buttons">
              <button 
                className="btn btn-primary"
                onClick={() => setView('create')}
              >
                Create Tournament
              </button>
              <button 
                className="btn btn-secondary"
                onClick={() => setView('join')}
              >
                Join Tournament
              </button>
            </div>

            <div className="tournaments-list">
              <h3>Active Tournaments</h3>
              {tournaments.length === 0 ? (
                <p>No active tournaments</p>
              ) : (
                <div className="tournament-cards">
                  {tournaments.map(tournament => (
                    <div key={tournament.id} className="tournament-card">
                      <h4>{tournament.name}</h4>
                      <p>Players: {tournament.players?.length || 0}</p>
                      <p>Rounds: {tournament.rounds?.length || 0}/{tournament.maxRounds}</p>
                      <p>Time Control: {tournament.timeControl}</p>
                      <button 
                        className="btn btn-small"
                        onClick={() => joinTournament(tournament.id)}
                        disabled={loading}
                      >
                        Join
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'create' && (
          <div className="create-view">
            <h2>Create New Tournament</h2>
            <form onSubmit={(e) => { e.preventDefault(); createTournament(); }}>
              <div className="form-group">
                <label>Tournament Name</label>
                <input
                  type="text"
                  value={newTournament.name}
                  onChange={(e) => setNewTournament({...newTournament, name: e.target.value})}
                  placeholder="Enter tournament name"
                  required
                />
              </div>
              <div className="form-group">
                <label>Max Rounds</label>
                <select
                  value={newTournament.maxRounds}
                  onChange={(e) => setNewTournament({...newTournament, maxRounds: parseInt(e.target.value)})}
                >
                  <option value={3}>3 Rounds</option>
                  <option value={4}>4 Rounds</option>
                  <option value={5}>5 Rounds</option>
                  <option value={6}>6 Rounds</option>
                  <option value={7}>7 Rounds</option>
                </select>
              </div>
              <div className="form-group">
                <label>Time Control</label>
                <select
                  value={newTournament.timeControl}
                  onChange={(e) => setNewTournament({...newTournament, timeControl: e.target.value})}
                >
                  <option value="15+0">15+0</option>
                  <option value="30+0">30+0</option>
                  <option value="60+0">60+0</option>
                  <option value="90+30">90+30</option>
                </select>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'Creating...' : 'Create Tournament'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setView('home')}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {view === 'join' && (
          <div className="join-view">
            <h2>Join Tournament</h2>
            <form onSubmit={(e) => { e.preventDefault(); }}>
              <div className="form-group">
                <label>Your Name</label>
                <input
                  type="text"
                  value={newPlayer.name}
                  onChange={(e) => setNewPlayer({...newPlayer, name: e.target.value})}
                  placeholder="Enter your name"
                  required
                />
              </div>
              <div className="form-group">
                <label>Rating</label>
                <input
                  type="number"
                  value={newPlayer.rating}
                  onChange={(e) => setNewPlayer({...newPlayer, rating: parseInt(e.target.value)})}
                  min="0"
                  max="3000"
                />
              </div>
              <div className="form-group">
                <label>Email (optional)</label>
                <input
                  type="email"
                  value={newPlayer.email}
                  onChange={(e) => setNewPlayer({...newPlayer, email: e.target.value})}
                  placeholder="Enter your email"
                />
              </div>
              <div className="form-actions">
                <button 
                  type="button" 
                  className="btn btn-primary" 
                  onClick={() => {
                    if (tournaments.length > 0) {
                      joinTournament(tournaments[0].id)
                    } else {
                      setError('No tournaments available to join')
                    }
                  }}
                  disabled={loading}
                >
                  {loading ? 'Joining...' : 'Join Tournament'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setView('home')}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {view === 'tournament' && currentTournament && (
          <div className="tournament-view">
            <div className="tournament-header">
              <h2>{currentTournament.name}</h2>
              <div className="tournament-info">
                <span>Players: {players.length}</span>
                <span>Rounds: {rounds.length}/{currentTournament.maxRounds}</span>
                <span>Time Control: {currentTournament.timeControl}</span>
              </div>
            </div>

            <div className="tournament-tabs">
              <button 
                className={currentRound ? 'active' : ''}
                onClick={() => setCurrentRound(rounds[rounds.length - 1] || null)}
              >
                Current Round
              </button>
              <button 
                className={!currentRound ? 'active' : ''}
                onClick={() => setCurrentRound(null)}
              >
                Standings
              </button>
            </div>

            {currentRound ? (
              <div className="round-view">
                <div className="round-header">
                  <h3>Round {currentRound.roundNumber}</h3>
                  <div className="round-actions">
                    {rounds.length < currentTournament.maxRounds && players.length >= 2 && (
                      <button 
                        className="btn btn-primary"
                        onClick={startNextRound}
                        disabled={loading}
                      >
                        Start Next Round
                      </button>
                    )}
                  </div>
                </div>

                <div className="pairings">
                  {currentRound.pairings.map(pairing => (
                    <div key={pairing.id} className="pairing">
                      <div className="player white">
                        <span className="name">{pairing.whiteName}</span>
                        <span className="rating">({players.find(p => p.id === pairing.white)?.rating || 0})</span>
                      </div>
                      <div className="vs">vs</div>
                      <div className="player black">
                        <span className="name">{pairing.blackName}</span>
                        <span className="rating">({players.find(p => p.id === pairing.black)?.rating || 0})</span>
                      </div>
                      <div className="result">
                        {pairing.result ? (
                          <span className="result-display">{pairing.result}</span>
                        ) : (
                          <div className="result-buttons">
                            <button 
                              className="btn btn-small"
                              onClick={() => updatePairingResult(pairing.id, '1-0')}
                            >
                              1-0
                            </button>
                            <button 
                              className="btn btn-small"
                              onClick={() => updatePairingResult(pairing.id, '0.5-0.5')}
                            >
                              ½-½
                            </button>
                            <button 
                              className="btn btn-small"
                              onClick={() => updatePairingResult(pairing.id, '0-1')}
                            >
                              0-1
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="standings-view">
                <h3>Standings</h3>
                <div className="standings-table">
                  <div className="standings-header">
                    <span>Rank</span>
                    <span>Name</span>
                    <span>Rating</span>
                    <span>Score</span>
                    <span>Games</span>
                  </div>
                  {getStandings().map((player, index) => (
                    <div key={player.id} className="standings-row">
                      <span className="rank">{index + 1}</span>
                      <span className="name">{player.name}</span>
                      <span className="rating">{player.rating}</span>
                      <span className="score">{player.score}</span>
                      <span className="games">{player.gamesPlayed}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="players-section">
              <h3>Add Player</h3>
              <form onSubmit={(e) => { e.preventDefault(); addPlayer(); }}>
                <div className="form-row">
                  <input
                    type="text"
                    value={newPlayer.name}
                    onChange={(e) => setNewPlayer({...newPlayer, name: e.target.value})}
                    placeholder="Player name"
                    required
                  />
                  <input
                    type="number"
                    value={newPlayer.rating}
                    onChange={(e) => setNewPlayer({...newPlayer, rating: parseInt(e.target.value)})}
                    placeholder="Rating"
                    min="0"
                    max="3000"
                  />
                  <button type="submit" className="btn btn-primary">
                    Add Player
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
