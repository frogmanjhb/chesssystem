# ♔ Chess Tournament Manager

A comprehensive, single-file React application for managing Swiss System chess tournaments with real-time collaboration features. Built with React, Express.js, PostgreSQL, and Socket.io.

## ✨ Features

- **Swiss System Pairing Algorithm** - Automatic pairing based on scores and ratings
- **Real-time Collaboration** - Multiple users can manage the same tournament simultaneously
- **Responsive Design** - Works perfectly on desktop, tablet, and mobile devices
- **Database Integration** - Persistent storage with Railway PostgreSQL
- **Tournament Management** - Create, join, and manage tournaments with ease
- **Live Updates** - Real-time score updates and pairing changes
- **Modern UI** - Beautiful, intuitive interface with smooth animations

## 🚀 Quick Start

### Prerequisites

- Node.js (v16 or higher)
- PostgreSQL database (Railway recommended)
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd chesssystem
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   DATABASE_URL=your_railway_postgres_connection_string
   NODE_ENV=production
   PORT=5000
   CLIENT_URL=http://localhost:3000
   REACT_APP_SERVER_URL=http://localhost:5000
   ```

4. **Build the application**
   ```bash
   npm run build
   ```

5. **Start the server**
   ```bash
   npm start
   ```

6. **Access the application**
   Open your browser and navigate to `http://localhost:5000`

### Development Mode

For development with hot reload:

1. **Start the backend server**
   ```bash
   node server.js
   ```

2. **Start the frontend development server** (in a new terminal)
   ```bash
   npm run dev
   ```

3. **Access the application**
   Open your browser and navigate to `http://localhost:3000`

## 🏗️ Project Structure

```
chesssystem/
├── src/
│   ├── App.jsx          # Main React component (single file)
│   ├── App.css          # Complete styling
│   └── main.jsx         # React entry point
├── server.js            # Express.js backend with database integration
├── package.json         # Dependencies and scripts
├── vite.config.js       # Vite configuration
├── index.html           # HTML template
└── README.md           # This file
```

## 🎯 How It Works

### Swiss System Algorithm

The application implements a sophisticated Swiss System pairing algorithm that:

1. **Sorts players** by current score (descending), then by rating (descending)
2. **Finds optimal pairings** by matching players with similar scores
3. **Avoids rematches** by checking previous round history
4. **Handles byes** for odd numbers of players
5. **Updates scores** automatically after each round

### Real-time Features

- **Socket.io integration** for live updates
- **Collaborative editing** - multiple users can manage the same tournament
- **Instant score updates** - changes appear immediately for all users
- **Live pairing updates** - new rounds are visible to all participants

### Database Schema

The application uses PostgreSQL with the following tables:

- **tournaments** - Tournament information (name, rounds, time control)
- **players** - Player details (name, rating, email, score)
- **rounds** - Round information (round number, date)
- **pairings** - Game pairings (white, black, result)

## 🎮 Usage

### Creating a Tournament

1. Click "Create Tournament" on the home page
2. Enter tournament name, select max rounds and time control
3. Click "Create Tournament" to start

### Adding Players

1. Navigate to your tournament
2. Scroll to the "Add Player" section
3. Enter player name, rating, and optional email
4. Click "Add Player"

### Starting Rounds

1. Ensure you have at least 2 players
2. Click "Start Next Round" to generate pairings
3. The system will automatically pair players using Swiss System rules

### Recording Results

1. In the current round view, find the pairing
2. Click the appropriate result button (1-0, ½-½, 0-1)
3. Scores will update automatically

### Viewing Standings

1. Click the "Standings" tab
2. View current rankings based on scores and ratings
3. Standings update in real-time as results are recorded

## 🔧 Configuration

### Time Controls

The application supports various time controls:
- 15+0 (15 minutes, no increment)
- 30+0 (30 minutes, no increment)
- 60+0 (60 minutes, no increment)
- 90+30 (90 minutes + 30 seconds increment)

### Tournament Rounds

- Minimum: 3 rounds
- Maximum: 7 rounds
- Recommended: 5 rounds for most tournaments

## 🌐 Deployment

### Railway Deployment

1. **Connect to Railway**
   ```bash
   npm install -g @railway/cli
   railway login
   railway init
   ```

2. **Set environment variables**
   - `DATABASE_URL` - Your Railway PostgreSQL connection string
   - `NODE_ENV=production`
   - `PORT` - Railway will set this automatically

3. **Deploy**
   ```bash
   railway up
   ```

### Other Platforms

The application can be deployed to any platform that supports Node.js and PostgreSQL:

- **Heroku** - Use the included `Procfile`
- **Vercel** - Deploy with serverless functions
- **DigitalOcean** - Use App Platform or Droplets
- **AWS** - Deploy to EC2 or Elastic Beanstalk

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/your-repo/chesssystem/issues) page
2. Create a new issue with detailed information
3. Include steps to reproduce any bugs

## 🎉 Acknowledgments

- Swiss System pairing algorithm based on FIDE regulations
- UI design inspired by modern chess applications
- Real-time features powered by Socket.io
- Database integration with Railway PostgreSQL

---

**Happy Tournament Managing!** ♔
