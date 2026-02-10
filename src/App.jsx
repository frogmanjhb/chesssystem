import React, { useState, useEffect, useCallback } from 'react'
import io from 'socket.io-client'
import './App.css'

// Note: Database connection is handled in server.js

// Socket connection
const getServerUrl = () => {
  if (import.meta.env.VITE_SERVER_URL) {
    return import.meta.env.VITE_SERVER_URL
  }
  // In production, use the current domain
  if (window.location.hostname !== 'localhost') {
    return window.location.origin
  }
  // Development fallback
  return 'http://localhost:5000'
}

const socket = io(getServerUrl())

const App = () => {
  // Authentication state
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authView, setAuthView] = useState('login') // login, register
  const [authForm, setAuthForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: ''
  })
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

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
    firstName: '',
    lastName: '',
    rating: 1200
  })
  const [editingPlayer, setEditingPlayer] = useState(null)
  const [bulkPlayers, setBulkPlayers] = useState('')
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Swiss System pairing algorithm
  const calculateSwissPairings = useCallback((players, roundNumber) => {
    if (players.length < 2) return []

    // Filter out disabled players for pairing
    const activePlayers = players.filter(player => !player.disabled)
    if (activePlayers.length < 2) return []

    // Sort players by score (descending), then by rating (descending)
    const sortedPlayers = [...activePlayers].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.rating - a.rating
    })

    const pairings = []
    const used = new Set()
    const isOddNumberOfPlayers = sortedPlayers.length % 2 === 1
    let byeGiven = false

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

        // First try to find opponent with same score who hasn't played before
        if (!havePlayed && scoreDiff === 0) {
          bestOpponent = player2
          bestOpponentIndex = j
          break // Perfect match, take it immediately
        }
        // If no perfect score match, find the best available opponent
        else if (!havePlayed && (bestOpponent === null || scoreDiff < minScoreDiff)) {
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
        // If no opponent found, try to find any available opponent (even if they've played before)
        let fallbackOpponent = null
        let fallbackIndex = -1
        
        for (let j = i + 1; j < sortedPlayers.length; j++) {
          if (used.has(j)) continue
          fallbackOpponent = sortedPlayers[j]
          fallbackIndex = j
          break
        }
        
        if (fallbackOpponent) {
          // Pair with any available opponent
          pairings.push({
            id: `pairing-${Date.now()}-${Math.random()}`,
            white: player1.id,
            black: fallbackOpponent.id,
            whiteName: player1.name,
            blackName: fallbackOpponent.name,
            result: null,
            round: roundNumber
          })
          used.add(i)
          used.add(fallbackIndex)
        } else if (isOddNumberOfPlayers && !byeGiven) {
          // Give a bye only if odd number of players and no opponent available
        pairings.push({
          id: `bye-${Date.now()}-${Math.random()}`,
          white: player1.id,
          black: null,
          whiteName: player1.name,
          blackName: 'BYE',
          result: '1-0',
          round: roundNumber
        })
          byeGiven = true
          used.add(i)
        } else {
          // This should never happen in a proper Swiss system
        used.add(i)
        }
      }
    }

    return pairings
  }, [rounds])

  // Authentication functions
  const register = async () => {
    setAuthLoading(true)
    setAuthError('')
    
    try {
      console.log('Attempting registration with data:', authForm)
      const url = `${getServerUrl()}/api/auth/register`
      console.log('Registration URL:', url)
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(authForm)
      })

      console.log('Registration response status:', response.status)
      const data = await response.json()
      console.log('Registration response data:', data)

      if (response.ok) {
        setToken(data.token)
        setUser(data.user)
        setIsAuthenticated(true)
        localStorage.setItem('token', data.token)
        setAuthForm({ firstName: '', lastName: '', email: '', password: '' })
        setView('home')
      } else {
        setAuthError(data.error)
      }
    } catch (error) {
      console.error('Registration error:', error)
      setAuthError('Registration failed. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const login = async () => {
    setAuthLoading(true)
    setAuthError('')
    
    try {
      console.log('Attempting login with email:', authForm.email)
      const url = `${getServerUrl()}/api/auth/login`
      console.log('Login URL:', url)
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: authForm.email,
          password: authForm.password
        })
      })

      console.log('Login response status:', response.status)
      const data = await response.json()
      console.log('Login response data:', data)

      if (response.ok) {
        setToken(data.token)
        setUser(data.user)
        setIsAuthenticated(true)
        localStorage.setItem('token', data.token)
        setAuthForm({ firstName: '', lastName: '', email: '', password: '' })
        setView('home')
      } else {
        setAuthError(data.error)
      }
    } catch (error) {
      console.error('Login error:', error)
      setAuthError('Login failed. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const logout = () => {
    setToken(null)
    setUser(null)
    setIsAuthenticated(false)
    localStorage.removeItem('token')
    setView('home')
    setCurrentTournament(null)
    setPlayers([])
    setRounds([])
    setCurrentRound(null)
  }

  const checkAuth = async () => {
    if (!token) return

    try {
      const response = await fetch(`${getServerUrl()}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setUser(data.user)
        setIsAuthenticated(true)
      } else {
        logout()
      }
    } catch (error) {
      logout()
    }
  }

  // Load tournaments on mount
  useEffect(() => {
    checkAuth()
    if (isAuthenticated) {
    loadTournaments()
    }
    
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

  // Helper function for API calls with auth
  const apiCall = async (url, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    }
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    
    return fetch(`${getServerUrl()}${url}`, {
      ...options,
      headers
    })
  }

  // API calls
  const loadTournaments = async () => {
    try {
      const response = await apiCall('/api/tournaments')
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
      const response = await apiCall('/api/tournaments', {
        method: 'POST',
        body: JSON.stringify(newTournament)
      })
      
      if (response.ok) {
        const tournament = await response.json()
        setCurrentTournament(tournament)
        setView('players')
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


  const viewTournament = async (tournamentId) => {
    setLoading(true)
    try {
      const response = await apiCall(`/api/tournaments/${tournamentId}`)
      
      if (response.ok) {
        const tournament = await response.json()
        setCurrentTournament(tournament)
        setPlayers(tournament.players || [])
        setRounds(tournament.rounds || [])
        setView('players')
        setSuccess('Tournament loaded successfully!')
        socket.emit('joinTournament', tournamentId)
      } else {
        const error = await response.json()
        setError(error.message)
      }
    } catch (err) {
      setError('Failed to load tournament')
    } finally {
      setLoading(false)
    }
  }

  const addPlayer = async () => {
    if (!newPlayer.firstName.trim()) {
      setError('Player first name is required')
      return
    }

    const playerData = {
      name: `${newPlayer.firstName} ${newPlayer.lastName}`.trim(),
      rating: newPlayer.rating
    }

    try {
      const response = await apiCall(`/api/tournaments/${currentTournament.id}/players`, {
        method: 'POST',
        body: JSON.stringify(playerData)
      })
      
      if (response.ok) {
        const tournament = await response.json()
        setCurrentTournament(tournament)
        setPlayers(tournament.players || [])
        setNewPlayer({ firstName: '', lastName: '', rating: 1200 })
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

  const addBulkPlayers = async () => {
    if (!bulkPlayers.trim()) {
      setError('Please enter player data')
      return
    }

    const lines = bulkPlayers.split('\n').filter(line => line.trim())
    const players = []

    for (const line of lines) {
      const trimmedLine = line.trim()
      if (trimmedLine) {
        // Split by comma or space
        const parts = trimmedLine.split(/[,\s]+/).filter(part => part.trim())
        if (parts.length >= 2) {
          const firstName = parts[0].trim()
          const lastName = parts[1].trim()
          players.push({
            name: `${firstName} ${lastName}`,
            rating: 1200 // Default rating
          })
        }
      }
    }

    if (players.length === 0) {
      setError('No valid players found. Format: FirstName LastName (one per line)')
      return
    }

    setLoading(true)
    try {
      for (const player of players) {
        await apiCall(`/api/tournaments/${currentTournament.id}/players`, {
          method: 'POST',
          body: JSON.stringify(player)
        })
      }
      
      const response = await apiCall(`/api/tournaments/${currentTournament.id}`)
      const tournament = await response.json()
      setCurrentTournament(tournament)
      setPlayers(tournament.players || [])
      setBulkPlayers('')
      setShowBulkImport(false)
      setSuccess(`${players.length} players added successfully!`)
      socket.emit('tournamentUpdate', currentTournament.id)
    } catch (err) {
      setError('Failed to add players')
    } finally {
      setLoading(false)
    }
  }

  const deletePlayer = async (playerId) => {
    if (!confirm('Are you sure you want to delete this player?')) return

    try {
      const response = await apiCall(`/api/tournaments/${currentTournament.id}/players/${playerId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        const tournament = await response.json()
        setCurrentTournament(tournament)
        setPlayers(tournament.players || [])
        setSuccess('Player deleted successfully!')
        socket.emit('tournamentUpdate', currentTournament.id)
      } else {
        const error = await response.json()
        setError(error.message)
      }
    } catch (err) {
      setError('Failed to delete player')
    }
  }

  const updatePlayer = async (playerId, updatedData) => {
    try {
      const response = await apiCall(`/api/tournaments/${currentTournament.id}/players/${playerId}`, {
        method: 'PUT',
        body: JSON.stringify(updatedData)
      })
      
      if (response.ok) {
        const tournament = await response.json()
        setCurrentTournament(tournament)
        setPlayers(tournament.players || [])
        setEditingPlayer(null)
        setSuccess('Player updated successfully!')
        socket.emit('tournamentUpdate', currentTournament.id)
      } else {
        const error = await response.json()
        setError(error.message)
      }
    } catch (err) {
      setError('Failed to update player')
    }
  }

  const togglePlayerDisabled = async (playerId, disabled) => {
    try {
      const response = await apiCall(`/api/tournaments/${currentTournament.id}/players/${playerId}`, {
        method: 'PUT',
        body: JSON.stringify({ disabled })
      })
      
      if (response.ok) {
        const tournament = await response.json()
        setCurrentTournament(tournament)
        setPlayers(tournament.players || [])
        setSuccess(disabled ? 'Player marked as absent' : 'Player marked as present')
        socket.emit('tournamentUpdate', currentTournament.id)
      } else {
        const error = await response.json()
        setError(error.message)
      }
    } catch (err) {
      setError('Failed to update player status')
    }
  }

  const startEditPlayer = (player) => {
    const nameParts = player.name.split(' ')
    const firstName = nameParts[0] || ''
    const lastName = nameParts.slice(1).join(' ') || ''
    
    setEditingPlayer({
      id: player.id,
      firstName: firstName,
      lastName: lastName,
      rating: player.rating
    })
  }

  const deleteRound = async (roundId) => {
    if (!confirm('Are you sure you want to delete this round? This will also delete all pairings and results.')) return

    try {
      const response = await apiCall(`/api/tournaments/${currentTournament.id}/rounds/${roundId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        const tournament = await response.json()
        setCurrentTournament(tournament)
        setRounds(tournament.rounds || [])
        setCurrentRound(null)
        setSuccess('Round deleted successfully!')
        socket.emit('tournamentUpdate', currentTournament.id)
      } else {
        const error = await response.json()
        setError(error.message)
      }
    } catch (err) {
      setError('Failed to delete round')
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
      const response = await apiCall(`/api/tournaments/${currentTournament.id}/rounds`, {
        method: 'POST',
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
      const response = await apiCall(`/api/tournaments/${currentTournament.id}/pairings/${pairingId}`, {
        method: 'PUT',
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
        <div className="header-content">
        <h1>♔ Chess System</h1>
          {isAuthenticated ? (
            <div className="user-info">
              <span>Welcome, {user?.firstName} {user?.lastName}</span>
        <nav className="nav">
          <button 
            className={view === 'home' ? 'active' : ''} 
            onClick={() => setView('home')}
          >
            Home
          </button>
          {currentTournament && (
            <button 
                    className={(view === 'players' || view === 'standings' || view === 'all-rounds' || view === 'current-round') ? 'active' : ''} 
                    onClick={() => setView('players')}
            >
              Tournament
            </button>
          )}
          <button 
            className={`btn-help ${view === 'help' ? 'active' : ''}`}
            onClick={() => setView('help')}
          >
            Help
          </button>
        </nav>
              <button className="btn btn-small btn-secondary" onClick={logout}>
                Sign Out
              </button>
            </div>
          ) : (
            <div className="auth-buttons">
              <button 
                className="btn btn-help"
                onClick={() => setView('help')}
              >
                Help
              </button>
              <button 
                className="btn btn-primary"
                onClick={() => setView('login')}
              >
                Sign In
              </button>
              <button 
                className="btn btn-secondary"
                onClick={() => setView('register')}
              >
                Sign Up
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="main-content">
        {error && <div className="alert error">{error}</div>}
        {success && <div className="alert success">{success}</div>}

        {/* Authentication Views */}
        {view === 'login' && (
          <div className="auth-container">
            <div className="auth-card">
              <div className="auth-header">
                <h2>Sign In</h2>
                <p>Welcome back! Sign in to manage your chess tournaments</p>
              </div>

              {authError && (
                <div className="auth-error">
                  {authError}
                </div>
              )}

              <form className="auth-form" onSubmit={(e) => {
                e.preventDefault()
                login()
              }}>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={authForm.email}
                    onChange={(e) => setAuthForm({...authForm, email: e.target.value})}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    value={authForm.password}
                    onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                    required
                  />
                </div>
                
                <button 
                  type="submit" 
                  className="btn btn-primary auth-submit"
                  disabled={authLoading}
                >
                  {authLoading ? 'Signing In...' : 'Sign In'}
                </button>
              </form>

              <div className="auth-switch">
                <p>Don't have an account? <button className="link-button" onClick={() => setView('register')}>Sign Up</button></p>
              </div>
            </div>
          </div>
        )}

        {view === 'register' && (
          <div className="auth-container">
            <div className="auth-card">
              <div className="auth-header">
                <h2>Sign Up</h2>
                <p>Create your account to start managing chess tournaments</p>
              </div>

              {authError && (
                <div className="auth-error">
                  {authError}
                </div>
              )}

              <form className="auth-form" onSubmit={(e) => {
                e.preventDefault()
                register()
              }}>
                <div className="form-group">
                  <label>First Name</label>
                  <input
                    type="text"
                    value={authForm.firstName}
                    onChange={(e) => setAuthForm({...authForm, firstName: e.target.value})}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input
                    type="text"
                    value={authForm.lastName}
                    onChange={(e) => setAuthForm({...authForm, lastName: e.target.value})}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={authForm.email}
                    onChange={(e) => setAuthForm({...authForm, email: e.target.value})}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    value={authForm.password}
                    onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                    required
                  />
                </div>
                
                <button 
                  type="submit" 
                  className="btn btn-primary auth-submit"
                  disabled={authLoading}
                >
                  {authLoading ? 'Creating Account...' : 'Sign Up'}
                </button>
              </form>

              <div className="auth-switch">
                <p>Already have an account? <button className="link-button" onClick={() => setView('login')}>Sign In</button></p>
              </div>
            </div>
          </div>
        )}

        {view === 'home' && (
          <div className="home-view">
            <div className="welcome-hero">
              <div className="hero-content">
                <div className="hero-badge">
                  <span className="badge-icon">♔</span>
                  <span className="badge-text">Chess System</span>
            </div>
                <h1 className="hero-title">
                  Organize Epic <span className="gradient-text">Chess Battles</span>
                </h1>
                <p className="hero-description">
                  The ultimate tool for teachers to create and manage chess tournaments. 
                  Add your students, generate fair Swiss pairings, and track their progress with ease.
                </p>
                {isAuthenticated ? (
                  <div className="hero-stats">
                    <div className="stat-item">
                      <div className="stat-number">{tournaments.length}</div>
                      <div className="stat-label">Tournaments</div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-number">{tournaments.reduce((sum, t) => sum + (t.playerCount || 0), 0)}</div>
                      <div className="stat-label">Players</div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-number">{tournaments.reduce((sum, t) => sum + (t.roundCount || 0), 0)}</div>
                      <div className="stat-label">Rounds Played</div>
                    </div>
                  </div>
                ) : (
                  <div className="hero-cta">
                    <p className="cta-text">Ready to start your first tournament?</p>
                    <div className="cta-buttons">
              <button 
                        className="btn btn-primary btn-large"
                        onClick={() => setView('register')}
              >
                        Get Started
              </button>
              <button 
                        className="btn btn-secondary btn-large"
                        onClick={() => setView('login')}
              >
                        Sign In
              </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="hero-visual">
                <div className="chess-board-animation">
                  {Array.from({ length: 64 }, (_, i) => (
                    <div key={i} className="board-square"></div>
                  ))}
                </div>
              </div>
            </div>

            {isAuthenticated && (
              <div className="action-section">
                <div className="action-cards">
                  <div className="action-card primary-card">
                    <div className="card-icon">🏆</div>
                    <h3>Create Tournament</h3>
                    <p>Start a new chess tournament with custom settings and manage your students' chess competitions.</p>
                    <button 
                      className="btn btn-primary btn-animated"
                      onClick={() => setView('create')}
                    >
                      <span className="btn-text">Create New Tournament</span>
                      <span className="btn-icon">→</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isAuthenticated && (
              <div className="tournaments-section">
                <div className="section-header">
                  <h2>Recent Tournaments</h2>
                  <p>Continue where you left off or explore past competitions</p>
                </div>
              {tournaments.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">♟️</div>
                    <h3>No tournaments yet</h3>
                    <p>Create your first tournament to get started with organizing chess competitions!</p>
                  </div>
                ) : (
                  <div className="tournaments-grid">
                  {tournaments.map(tournament => (
                      <div key={tournament.id} className="tournament-card modern-card">
                        <div className="card-header">
                      <h4>{tournament.name}</h4>
                          <div className="tournament-status">
                            <span className={`status-dot ${(tournament.roundCount || 0) >= tournament.maxRounds ? 'completed' : 'active'}`}></span>
                            <span className="status-text">
                              {(tournament.roundCount || 0) >= tournament.maxRounds ? 'Completed' : 'Active'}
                            </span>
                          </div>
                        </div>
                        <div className="card-stats">
                          <div className="stat">
                            <span className="stat-icon">👥</span>
                            <span className="stat-value">{tournament.playerCount || 0}</span>
                            <span className="stat-label">Players</span>
                          </div>
                          <div className="stat">
                            <span className="stat-icon">🔄</span>
                            <span className="stat-value">{tournament.roundCount || 0}/{tournament.maxRounds}</span>
                            <span className="stat-label">Rounds</span>
                          </div>
                          <div className="stat">
                            <span className="stat-icon">⏱️</span>
                            <span className="stat-value">{tournament.timeControl}</span>
                            <span className="stat-label">Time</span>
                          </div>
                        </div>
                        <div className="card-actions">
                      <button 
                            className="btn btn-primary btn-small btn-animated"
                            onClick={() => viewTournament(tournament.id)}
                        disabled={loading}
                      >
                            <span className="btn-text">Manage Tournament</span>
                            <span className="btn-icon">⚙️</span>
                      </button>
                        </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
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

        {view === 'help' && (
          <div className="help-view">
            <div className="help-hero">
              <div className="help-icon">❓</div>
              <h1>Getting Started with Chess System</h1>
              <p className="help-subtitle">Follow these simple steps to organize your chess tournament</p>
            </div>

            <div className="help-content">
              <div className="help-section">
                <div className="step-number">1</div>
                <div className="step-content">
                  <h3>Create Your Account</h3>
                  <ul>
                    <li>Click the <strong>"Sign Up"</strong> button in the top-right corner</li>
                    <li>Fill in your First Name, Last Name, Email, and Password</li>
                    <li>Click <strong>"Sign Up"</strong> to create your account</li>
                    <li>You'll be automatically logged in!</li>
                  </ul>
                </div>
              </div>

              <div className="help-section">
                <div className="step-number">2</div>
                <div className="step-content">
                  <h3>Create Your First Tournament</h3>
                  <ul>
                    <li>From the home page, click <strong>"Create New Tournament"</strong></li>
                    <li><strong>Tournament Name</strong>: Give it a descriptive name (e.g., "Spring Chess Championship")</li>
                    <li><strong>Max Rounds</strong>: Choose how many rounds to play (3-7 rounds)</li>
                    <li><strong>Time Control</strong>: Select the time limit per game (e.g., 30+0 means 30 minutes per player)</li>
                    <li>Click <strong>"Create Tournament"</strong></li>
                  </ul>
                </div>
              </div>

              <div className="help-section">
                <div className="step-number">3</div>
                <div className="step-content">
                  <h3>Add Students/Players</h3>
                  <p><strong>Option A: Add Players One at a Time</strong></p>
                  <ul>
                    <li>Enter the student's first name and last name</li>
                    <li>Enter their chess rating (use 1200 if you're not sure)</li>
                    <li>Click <strong>"Add Student"</strong></li>
                  </ul>
                  <p><strong>Option B: Bulk Import (Faster!)</strong></p>
                  <ul>
                    <li>Click <strong>"Bulk Import"</strong></li>
                    <li>Type or paste names, one per line (e.g., "John Doe")</li>
                    <li>Click <strong>"Import Students"</strong></li>
                  </ul>
                </div>
              </div>

              <div className="help-section">
                <div className="step-number">4</div>
                <div className="step-content">
                  <h3>Generate Your First Round</h3>
                  <ul>
                    <li>Once you have at least 2 students added, click <strong>"Generate New Round"</strong></li>
                    <li>The system will automatically create fair pairings using the Swiss system</li>
                    <li>Go to the <strong>"Current Round"</strong> tab to see the matches</li>
                  </ul>
                </div>
              </div>

              <div className="help-section">
                <div className="step-number">5</div>
                <div className="step-content">
                  <h3>Enter Game Results</h3>
                  <ul>
                    <li>In the <strong>"Current Round"</strong> tab, you'll see all the pairings</li>
                    <li>For each game, click the appropriate result button:</li>
                    <li className="result-examples">
                      <span className="result-badge white-win">1-0</span> White wins
                      <span className="result-badge draw">½-½</span> Draw
                      <span className="result-badge black-win">0-1</span> Black wins
                    </li>
                    <li>Results automatically update the standings!</li>
                  </ul>
                </div>
              </div>

              <div className="help-section">
                <div className="step-number">6</div>
                <div className="step-content">
                  <h3>View Standings</h3>
                  <ul>
                    <li>Click the <strong>"Standings"</strong> tab to see current rankings</li>
                    <li>Players are sorted by score, then by rating</li>
                    <li>Check who's leading the tournament!</li>
                  </ul>
                </div>
              </div>

              <div className="help-section">
                <div className="step-number">7</div>
                <div className="step-content">
                  <h3>Continue Playing</h3>
                  <ul>
                    <li>After all games in a round are complete, click <strong>"Generate New Round"</strong></li>
                    <li>The system creates new pairings based on current scores</li>
                    <li>Repeat until you've completed all rounds</li>
                    <li>When finished, click <strong>"End Tournament"</strong></li>
                  </ul>
                </div>
              </div>

              <div className="help-tips">
                <h3>✨ Quick Tips</h3>
                <div className="tips-grid">
                  <div className="tip-card">
                    <div className="tip-icon">✅</div>
                    <div className="tip-text">
                      <strong>Mark students as absent</strong>
                      <p>Use the "Absent" checkbox if a student can't play that round</p>
                    </div>
                  </div>
                  <div className="tip-card">
                    <div className="tip-icon">✏️</div>
                    <div className="tip-text">
                      <strong>Edit player info</strong>
                      <p>Click "Edit" next to any student to change their name or rating</p>
                    </div>
                  </div>
                  <div className="tip-card">
                    <div className="tip-icon">📋</div>
                    <div className="tip-text">
                      <strong>View all rounds</strong>
                      <p>Use the "All Rounds" tab to review past games</p>
                    </div>
                  </div>
                  <div className="tip-card">
                    <div className="tip-icon">🔄</div>
                    <div className="tip-text">
                      <strong>Real-time updates</strong>
                      <p>Multiple people can view the same tournament live!</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="help-footer">
                <p>That's it! You're ready to run your first chess tournament! 🏆</p>
                <button className="btn btn-primary btn-large" onClick={() => setView(isAuthenticated ? 'home' : 'register')}>
                  {isAuthenticated ? 'Back to Home' : 'Get Started Now'}
                </button>
              </div>
            </div>
          </div>
        )}

        {(view === 'players' || view === 'standings' || view === 'all-rounds' || view === 'current-round') && currentTournament && (
          <div className="tournament-view">
            <div className="tournament-header">
              <div className="tournament-title-section">
                <h2 className="tournament-name">{currentTournament.name}</h2>
                <div className="tournament-status">
                  <span className="status-badge active">Active Tournament</span>
                </div>
              </div>
              <div className="tournament-stats">
                <div className="stat-card">
                  <div className="stat-number">{players.length}</div>
                  <div className="stat-label">Students</div>
                </div>
                <div className="stat-card">
                  <div className="stat-number">{rounds.length}</div>
                  <div className="stat-label">Rounds Played</div>
                </div>
                <div className="stat-card">
                  <div className="stat-number">{currentTournament.maxRounds}</div>
                  <div className="stat-label">Max Rounds</div>
                </div>
                <div className="stat-card">
                  <div className="stat-number">{currentTournament.timeControl}</div>
                  <div className="stat-label">Time Control</div>
                </div>
              </div>
            </div>

            <div className="tournament-tabs">
              <button 
                className={`tab-button ${view === 'players' ? 'active' : ''}`}
                onClick={() => setView('players')}
              >
                <span className="tab-icon">👥</span>
                <span className="tab-text">Students</span>
                <span className="tab-count">{players.length}</span>
              </button>
              <button 
                className={`tab-button ${view === 'standings' ? 'active' : ''}`}
                onClick={() => setView('standings')}
              >
                <span className="tab-icon">🏆</span>
                <span className="tab-text">Standings</span>
                <span className="tab-count">{players.length}</span>
              </button>
              <button 
                className={`tab-button ${view === 'all-rounds' ? 'active' : ''}`}
                onClick={() => setView('all-rounds')}
              >
                <span className="tab-icon">📋</span>
                <span className="tab-text">All Rounds</span>
                <span className="tab-count">{rounds.length}</span>
              </button>
              <button 
                className={`tab-button ${view === 'current-round' ? 'active' : ''}`}
                onClick={() => setView('current-round')}
              >
                <span className="tab-icon">⚡</span>
                <span className="tab-text">Current Round</span>
                <span className="tab-count">{rounds.length > 0 ? rounds[rounds.length - 1].roundNumber : 0}</span>
              </button>
            </div>

            {/* Tournament Actions - Always Visible */}
            <div className="generate-round-section">
              <div className="tournament-actions">
                <button 
                  className="btn btn-primary btn-large"
                  onClick={startNextRound}
                  disabled={loading || rounds.length >= currentTournament.maxRounds || players.length < 2}
                >
                  {loading ? 'Generating...' : 'Generate New Round'}
                </button>
                <button 
                  className="btn btn-danger btn-large"
                  onClick={() => {
                    if (window.confirm('Are you sure you want to end this tournament? This action cannot be undone.')) {
                      // TODO: Implement end tournament functionality
                      setSuccess('Tournament ended successfully!');
                    }
                  }}
                  disabled={loading}
                >
                  🏁 End Tournament
                </button>
              </div>
              {rounds.length >= currentTournament.maxRounds && (
                <p className="alert error">Tournament has reached maximum rounds ({currentTournament.maxRounds})</p>
              )}
              {players.length < 2 && (
                <p className="alert error">Need at least 2 players to generate rounds</p>
              )}
            </div>

            {/* Players Tab */}
            {view === 'players' && (
              <div className="players-section">
                <div className="players-header">
                  <h3>Students ({players.length})</h3>
                  <div className="players-actions">
                    <button 
                      className="btn btn-secondary"
                      onClick={() => setShowBulkImport(!showBulkImport)}
                    >
                      {showBulkImport ? 'Hide Bulk Import' : 'Bulk Import'}
                    </button>
                  </div>
                </div>

                {showBulkImport && (
                  <div className="bulk-import">
                    <h4>Bulk Import Students</h4>
                    <p>Format: FirstName LastName (one per line, separated by space or comma)</p>
                    <textarea
                      value={bulkPlayers}
                      onChange={(e) => setBulkPlayers(e.target.value)}
                      placeholder="John Doe&#10;Jane Smith&#10;Bob Wilson&#10;Alice Johnson"
                      rows="5"
                    />
                    <div className="form-actions">
                      <button 
                        className="btn btn-primary"
                        onClick={addBulkPlayers}
                        disabled={loading}
                      >
                        {loading ? 'Importing...' : 'Import Students'}
                      </button>
                      <button 
                        className="btn btn-secondary"
                        onClick={() => setShowBulkImport(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <form onSubmit={(e) => { e.preventDefault(); addPlayer(); }}>
                  <div className="form-row">
                <input
                  type="text"
                      value={newPlayer.firstName}
                      onChange={(e) => setNewPlayer({...newPlayer, firstName: e.target.value})}
                      placeholder="First name"
                  required
                />
                    <input
                      type="text"
                      value={newPlayer.lastName}
                      onChange={(e) => setNewPlayer({...newPlayer, lastName: e.target.value})}
                      placeholder="Last name"
                      required
                    />
                <input
                  type="number"
                  value={newPlayer.rating}
                  onChange={(e) => setNewPlayer({...newPlayer, rating: parseInt(e.target.value)})}
                      placeholder="Rating"
                  min="0"
                  max="3000"
                      required
                />
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      {loading ? 'Adding...' : 'Add Student'}
                    </button>
              </div>
                </form>

                <div className="students-list">
                  {players.map(player => (
                    <div key={player.id} className={`student-item ${player.disabled ? 'disabled' : ''}`}>
                      <div className="student-info">
                        <div className="student-name">{player.name}</div>
                        <div className="student-details">
                          <span className="rating">Rating: {player.rating}</span>
                          <span className="score">Score: {getPlayerScore(player.id)}</span>
                          {player.disabled && <span className="status-absent">ABSENT</span>}
                        </div>
                      </div>
                      <div className="student-actions">
                        <label className="disable-toggle">
                <input
                            type="checkbox"
                            checked={player.disabled || false}
                            onChange={(e) => togglePlayerDisabled(player.id, e.target.checked)}
                          />
                          <span className="toggle-label">Absent</span>
                        </label>
                        <button 
                          className="btn btn-small btn-secondary"
                          onClick={() => startEditPlayer(player)}
                        >
                          Edit
                        </button>
                        <button 
                          className="btn btn-small btn-danger"
                          onClick={() => deletePlayer(player.id)}
                        >
                          Delete
                        </button>
                      </div>
                      {editingPlayer && editingPlayer.id === player.id && (
                        <div className="player-edit-modal">
                          <div className="player-edit">
                            <h4>Edit Student</h4>
                            <div className="edit-fields">
                              <input
                                type="text"
                                value={editingPlayer.firstName || ''}
                                onChange={(e) => setEditingPlayer({...editingPlayer, firstName: e.target.value})}
                                placeholder="First name"
                              />
                              <input
                                type="text"
                                value={editingPlayer.lastName || ''}
                                onChange={(e) => setEditingPlayer({...editingPlayer, lastName: e.target.value})}
                                placeholder="Last name"
                              />
                              <input
                                type="number"
                                value={editingPlayer.rating || player.rating}
                                onChange={(e) => setEditingPlayer({...editingPlayer, rating: parseInt(e.target.value)})}
                                placeholder="Rating"
                              />
                            </div>
                            <div className="edit-actions">
                <button 
                  className="btn btn-primary" 
                                onClick={() => updatePlayer(player.id, {
                                  name: `${editingPlayer.firstName} ${editingPlayer.lastName}`.trim(),
                                  rating: editingPlayer.rating
                                })}
                              >
                                Save
                </button>
                              <button 
                                className="btn btn-secondary"
                                onClick={() => setEditingPlayer(null)}
                              >
                  Cancel
                </button>
              </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
          </div>
        )}

            {/* Standings Tab */}
            {view === 'standings' && (
              <div className="standings-section">
                <h3>Tournament Standings</h3>
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

            {/* All Rounds Tab */}
            {view === 'all-rounds' && (
              <div className="rounds-section">
                <h3>All Rounds ({rounds.length})</h3>
                <div className="rounds-list">
                  {rounds.length === 0 ? (
                    <div className="no-rounds">
                      <p>No rounds have been created yet.</p>
                      <p>Add players and generate the first round to get started!</p>
                    </div>
                  ) : (
                    rounds.map(round => (
                      <div key={round.id} className="round-card">
                        <div className="round-header">
                          <h4>Round {round.roundNumber}</h4>
                          <div className="round-actions">
              <button 
                              className="btn btn-small"
                              onClick={() => setView('current-round')}
              >
                              View
              </button>
              <button 
                              className="btn btn-small btn-danger"
                              onClick={() => deleteRound(round.id)}
              >
                              Delete
              </button>
            </div>
                        </div>
                        <div className="round-pairings">
                          {round.pairings && round.pairings.length > 0 ? (
                            round.pairings.map(pairing => {
                              const getResultDisplay = (result) => {
                                if (!result || result === 'Pending') return 'Pending';
                                if (result === '1-0') return '1-0';
                                if (result === '0-1') return '0-1';
                                if (result === '½-½') return '½-½';
                                return result;
                              };

                              const getWinnerEmoji = (result, playerName, whiteName, blackName) => {
                                if (!result || result === 'Pending') return '';
                                if (result === '1-0' && playerName === whiteName) return '🏆';
                                if (result === '0-1' && playerName === blackName) return '🏆';
                                if (result === '½-½') return '🤝';
                                return '';
                              };

                              return (
                                <div key={pairing.id} className="pairing-summary">
                                  <div className="pairing-player">
                                    <span className="player-name">
                                      {pairing.whiteName}
                                      {getWinnerEmoji(pairing.result, pairing.whiteName, pairing.whiteName, pairing.blackName)}
                                    </span>
                                  </div>
                                  <div className="pairing-result">
                                    <span className="result-score">{getResultDisplay(pairing.result)}</span>
                                  </div>
                                  <div className="pairing-player">
                                    <span className="player-name">
                                      {pairing.blackName}
                                      {getWinnerEmoji(pairing.result, pairing.blackName, pairing.whiteName, pairing.blackName)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <p className="no-pairings">No pairings for this round</p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Current Round Tab */}
            {view === 'current-round' && (
              <div className="current-round-section">
                {rounds.length > 0 ? (
              <div className="round-view">
                <div className="round-header">
                      <h3>Round {rounds[rounds.length - 1].roundNumber}</h3>
                  <div className="round-actions">
                      <button 
                          className="btn btn-danger"
                          onClick={() => deleteRound(rounds[rounds.length - 1].id)}
                        disabled={loading}
                      >
                          {loading ? 'Deleting...' : 'Delete Round'}
                      </button>
                  </div>
                </div>
                <div className="pairings">
                      {rounds[rounds.length - 1].pairings.map(pairing => (
                    <div key={pairing.id} className="pairing">
                      <div className="player white">
                        <span className="name">{pairing.whiteName}</span>
                        <span className="rating">({players.find(p => p.id === pairing.white)?.rating || 0})</span>
                      </div>
                          <div className="pairing-center">
                        {pairing.result ? (
                              <div className="result-display">
                                <span className="result-score">{pairing.result}</span>
                                <button 
                                  className="btn btn-small btn-secondary"
                                  onClick={() => updatePairingResult(pairing.id, null)}
                                >
                                  Edit
                                </button>
                              </div>
                        ) : (
                          <div className="result-buttons">
                            <button 
                                  className="btn btn-small btn-success"
                              onClick={() => updatePairingResult(pairing.id, '1-0')}
                            >
                              1-0
                            </button>
                            <button 
                                  className="btn btn-small btn-warning"
                              onClick={() => updatePairingResult(pairing.id, '0.5-0.5')}
                            >
                              ½-½
                            </button>
                            <button 
                                  className="btn btn-small btn-success"
                              onClick={() => updatePairingResult(pairing.id, '0-1')}
                            >
                              0-1
                            </button>
                          </div>
                        )}
                      </div>
                          <div className="player black">
                            <span className="name">{pairing.blackName}</span>
                            <span className="rating">({players.find(p => p.id === pairing.black)?.rating || 0})</span>
                          </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
                  <div className="no-rounds">
                    <p>No rounds have been created yet.</p>
                    <p>Generate the first round to get started!</p>
                  </div>
                )}
              </div>
            )}

          </div>
        )}
      </main>
    </div>
  )
}

export default App
