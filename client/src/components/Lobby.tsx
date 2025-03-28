import React, { useEffect, useState } from 'react';
import { Match, PlayerRole } from '../../../shared/types/lobby';
import './Lobby.css';

interface LobbyProps {
  onJoinMatch: (matchId: string, role: PlayerRole) => void;
}

export const Lobby: React.FC<LobbyProps> = ({ onJoinMatch }) => {
  const [activeMatches, setActiveMatches] = useState<Match[]>([]);
  const [completedMatches, setCompletedMatches] = useState<Match[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initial fetch of matches
    fetchMatches();

    // Set up socket listeners for real-time updates
    const socket = (window as any).socket;
    
    if (socket) {
      socket.on('matchCreated', (match: Match) => {
        setActiveMatches(prev => [match, ...prev]);
      });

      socket.on('matchUpdated', (updatedMatch: Match) => {
        if (updatedMatch.status === 'completed') {
          // Remove from active matches and add to completed matches
          setActiveMatches(prev => prev.filter(match => match.id !== updatedMatch.id));
          setCompletedMatches(prev => [updatedMatch, ...prev]);
        } else {
          // Update in active matches
          setActiveMatches(prev => prev.map(match => 
            match.id === updatedMatch.id ? updatedMatch : match
          ));
        }
      });

      socket.on('matchRemoved', (removedMatchId: string) => {
        setActiveMatches(prev => prev.filter(match => match.id !== removedMatchId));
      });

      // Cleanup
      return () => {
        socket.off('matchCreated');
        socket.off('matchUpdated');
        socket.off('matchRemoved');
      };
    } else {
      setError('Socket connection not available. Real-time updates disabled.');
    }
  }, []);

  const fetchMatches = async () => {
    try {
      const response = await fetch('http://localhost:4000/api/lobby/matches');
      const data = await response.json();
      setActiveMatches(data.activeMatches);
      setCompletedMatches(data.completedMatches);
      setLoading(false);
    } catch (err) {
      setError('Failed to fetch matches');
      setLoading(false);
    }
  };

  const createMatch = async () => {
    if (!playerName.trim()) {
      setError('Please enter your name first');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('http://localhost:4000/api/lobby/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create match');
      }

      const data = await response.json();
      if (data.match) {
        // Since the server now automatically assigns the creator as player1,
        // we can directly transition to the game board
        onJoinMatch(data.match.id, 'player1');
      } else {
        throw new Error('No match data received from server');
      }
    } catch (err) {
      console.error('Failed to create match:', err);
      setError('Failed to create match: ' + (err instanceof Error ? err.message : 'Unknown error'));
      setLoading(false);
    }
  };

  const handleJoinMatch = async (matchId: string, role: PlayerRole) => {
    if (!playerName.trim()) {
      setError('Please enter your name first');
      return;
    }

    try {
      setLoading(true);
      
      const response = await fetch('http://localhost:4000/api/lobby/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId,
          role,
          playerName
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to join match');
      }

      const data = await response.json();
      if (data.success || data.match) {
        onJoinMatch(matchId, role);
      } else {
        throw new Error('Failed to join match: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Failed to join match:', err);
      setError('Failed to join match: ' + (err instanceof Error ? err.message : 'Unknown error'));
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="lobby loading">Loading matches...</div>;
  }

  return (
    <div className="lobby">
      <div className="lobby-header">
        <h1>Game Lobby</h1>
        <div className="player-name-input">
          <input
            type="text"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <button onClick={createMatch}>Create New Match</button>
        </div>
        {error && <div className="error-message">{error}</div>}
      </div>

      <div className="matches-list">
        <h2>Available Matches</h2>
        {activeMatches.length === 0 ? (
          <p>No matches available. Create one to start playing!</p>
        ) : (
          activeMatches.map(match => (
            <div key={match.id} className={`match-item ${match.status}`}>
              <div className="match-info">
                <span className="match-id">Match #{match.id.slice(0, 8)}</span>
                <span className="match-status">{match.status}</span>
              </div>
              <div className="match-players">
                <div className="player-slot">
                  Player 1: {match.player1 || 'Open'}
                </div>
                <div className="player-slot">
                  Player 2: {match.player2 || 'Open'}
                </div>
              </div>
              <div className="match-actions">
                {match.status === 'waiting' && (
                  <>
                    {!match.player1 && (
                      <button onClick={() => handleJoinMatch(match.id, 'player1')}>
                        Join as Player 1
                      </button>
                    )}
                    {!match.player2 && (
                      <button onClick={() => handleJoinMatch(match.id, 'player2')}>
                        Join as Player 2
                      </button>
                    )}
                  </>
                )}
                {match.status === 'in_progress' && (
                  <span className="match-full">Match in progress</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="completed-matches">
        <h2>Completed Matches</h2>
        {completedMatches.length === 0 ? (
          <p>No completed matches yet.</p>
        ) : (
          completedMatches.map(match => (
            <div key={match.id} className="match-item completed">
              <div className="match-info">
                <span className="match-id">Match #{match.id.slice(0, 8)}</span>
                <span className="match-status">Completed</span>
              </div>
              <div className="match-players">
                <div className="player-slot">
                  {match.player1}
                </div>
                <div className="player-slot">
                  {match.player2}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}; 