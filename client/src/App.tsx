import { useState, useEffect, useRef } from 'react';
import { GameState } from '@archess/shared';
import GameBoard from './components/GameBoard';
import { Lobby } from './components/Lobby';
import NetworkManager from './services/NetworkManager';
import { PlayerRole } from '../../shared/types/lobby';
import './App.css';

type AppScreen = 'lobby' | 'game';

function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<string | null>(null);
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('lobby');
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
  const networkManagerRef = useRef<NetworkManager>(new NetworkManager());
  const [showJoinNotification, setShowJoinNotification] = useState<boolean>(false);
  const [previousPlayersCount, setPreviousPlayersCount] = useState<number>(0);

  // Keep track of whether we've initialized the connection
  const connectionInitializedRef = useRef<boolean>(false);

  useEffect(() => {
    const networkManager = networkManagerRef.current;

    const init = async () => {
      if (connectionInitializedRef.current) {
        return;
      }

      try {
        setLoading(true);
        console.log('Initializing network connection...');
        await networkManager.connect();
        connectionInitializedRef.current = true;
        
        // Make socket globally available
        (window as any).socket = networkManager.getSocket();
        
        // Listen for game state updates
        networkManager.onGameStateUpdate((state) => {
          setGameState((currentState) => {
            // Only update if we don't have a state yet or if this update is for our current match
            if (!currentState || (state as any).matchId === (currentState as any).matchId) {
              return state;
            }
            return currentState;
          });
          
          if (loading) {
            setLoading(false);
          }
        });

        setLoading(false);
      } catch (err) {
        console.error('Network connection error:', err);
        setError('Failed to connect to server');
        setLoading(false);
      }
    };

    init();

    // Only disconnect when component unmounts
    return () => {
      if (connectionInitializedRef.current) {
        console.log('Disconnecting network manager');
        networkManager.disconnect();
        connectionInitializedRef.current = false;
      }
    };
  }, []); // Only run on mount

  // Handle match updates in a separate effect
  useEffect(() => {
    const socket = networkManagerRef.current.getSocket();
    if (!socket) return;

    const handleMatchUpdate = async (updatedMatch: any) => {
      console.log('Match update received:', updatedMatch);
      
      // Check if this is our current match
      if (currentMatchId && updatedMatch.id === currentMatchId) {
        // Update the match in our global list
        const currentMatches = (window as any).activeMatches || [];
        const matchIndex = currentMatches.findIndex((m: any) => m.id === currentMatchId);
        
        if (matchIndex >= 0) {
          currentMatches[matchIndex] = updatedMatch;
        } else {
          currentMatches.push(updatedMatch);
        }
        
        (window as any).activeMatches = currentMatches;
        
        // If the match is completed, show a message and return to lobby
        if (updatedMatch.status === 'completed') {
          console.log('Match completed, preparing to return to lobby');
          const playerKey = currentPlayer === 'player1' ? 'player1' : 'player2';
          const isWinner = updatedMatch[playerKey]?.includes('(Won)');
          const message = isWinner 
            ? 'You won! Your opponent has left the match.' 
            : 'Your opponent has left the match.';
          
          setError(message);
          
          // Return to lobby after delay
          setTimeout(() => {
            console.log('Returning to lobby');
            setCurrentScreen('lobby');
            setCurrentMatchId(null);
            setCurrentPlayer(null);
            setGameState(null);
            setPreviousPlayersCount(0);
            setShowJoinNotification(false);
            setError(null);
          }, 3000);
        }
        
        // If Player 2 just joined, fetch updated game state
        if (currentPlayer === 'player1' && 
            updatedMatch.player2 && 
            updatedMatch.status === 'in_progress') {
          try {
            const response = await fetch(`http://localhost:4000/api/game/${currentMatchId}`);
            if (response.ok) {
              const gameState = await response.json();
              setGameState(gameState);
            }
          } catch (err) {
            console.error('Failed to refresh game state after player 2 joined:', err);
          }
        }
      }
    };

    const handleMatchRemoval = (removedMatchId: string) => {
      console.log('Match removal event received:', removedMatchId);
      if (currentMatchId === removedMatchId) {
        setError('The match has been removed.');
        setTimeout(() => {
          console.log('Returning to lobby due to match removal');
          setCurrentScreen('lobby');
          setCurrentMatchId(null);
          setCurrentPlayer(null);
          setGameState(null);
          setPreviousPlayersCount(0);
          setShowJoinNotification(false);
          setError(null);
        }, 3000);
      }
    };

    socket.on('matchUpdated', handleMatchUpdate);
    socket.on('matchRemoved', handleMatchRemoval);

    return () => {
      console.log('Cleaning up socket listeners');
      socket.off('matchUpdated', handleMatchUpdate);
      socket.off('matchRemoved', handleMatchRemoval);
    };
  }, [currentMatchId, currentPlayer]); // Re-run when match or player changes

  // Keep the Player 2 join notification effect
  useEffect(() => {
    if (gameState && currentPlayer === 'player1' && currentScreen === 'game') {
      const currentPlayersCount = gameState.players.length;
      
      if (previousPlayersCount === 1 && currentPlayersCount === 2) {
        console.log('Player 2 has joined! Showing notification.');
        setShowJoinNotification(true);
        
        const timer = setTimeout(() => {
          setShowJoinNotification(false);
        }, 5000);
        
        return () => clearTimeout(timer);
      }
      
      setPreviousPlayersCount(currentPlayersCount);
    }
  }, [gameState?.players.length, currentPlayer, previousPlayersCount, currentScreen]);

  const resetGame = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:4000/api/game/reset', {
        method: 'POST',
      });
      const data = await response.json();
      setGameState(data);
      setLoading(false);
    } catch (err) {
      setError('Failed to reset game');
      setLoading(false);
    }
  };

  const handleJoinMatch = async (matchId: string, player: 'player1' | 'player2') => {
    setLoading(true);
    setError(null);
    
    try {
      // Set state here first
      setCurrentMatchId(matchId);
      setCurrentPlayer(player);
      
      const networkManager = networkManagerRef.current;
      
      // Make sure we have an active socket connection
      if (!networkManager.getConnectionStatus()) {
        await networkManager.connect();
        connectionInitializedRef.current = true;
      }
      
      // Tell the server about this player
      await networkManager.setPlayerId(player, matchId);
      
      // Fetch available matches to get player names
      const matchesResponse = await fetch(`http://localhost:4000/api/lobby/matches`);
      if (matchesResponse.ok) {
        const matchesData = await matchesResponse.json();
        // Store matches globally for player name lookup
        (window as any).activeMatches = matchesData.matches;
        
        // Only check for Player 2 joining if we are Player 1
        // and we're not creating a new match (already in-game)
        if (player === 'player1' && currentScreen === 'game') {
          const thisMatch = matchesData.matches.find((m: any) => m.id === matchId);
          if (thisMatch && thisMatch.player2 && thisMatch.status === 'in_progress') {
            console.log('Player 2 already in match when Player 1 joins!');
            setShowJoinNotification(true);
            setTimeout(() => setShowJoinNotification(false), 5000);
          }
        }
      }
      
      // Now fetch the game state
      const response = await fetch(`http://localhost:4000/api/game/${matchId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch game state: ${response.status}`);
      }
      
      const gameState = await response.json();
      setGameState(gameState);
      
      // Only check player count if we're already in game 
      // (to prevent showing notification when first creating a game)
      if (player === 'player1' && currentScreen === 'game' && gameState.players.length === 2) {
        console.log('Game state shows Player 2 has already joined!');
        setShowJoinNotification(true);
        setTimeout(() => setShowJoinNotification(false), 5000);
      }
      
      // IMPORTANT: Finally transition to game screen
      setCurrentScreen('game');
      setLoading(false);
    } catch (error) {
      console.error('Error joining match:', error);
      setError(`Failed to join match: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setLoading(false);
    }
  };

  const handleExitMatch = async () => {
    try {
      if (currentMatchId && currentPlayer) {
        // Notify the server about the exit
        await networkManagerRef.current.exitMatch(currentMatchId, currentPlayer);
      }
    } catch (err) {
      console.error('Error exiting match:', err);
      setError('Failed to exit match properly');
    } finally {
      // Reset match-specific state but don't disconnect
      setCurrentScreen('lobby');
      setCurrentMatchId(null);
      setCurrentPlayer(null);
      setGameState(null);
      setPreviousPlayersCount(0); // Reset player count tracking
      setShowJoinNotification(false); // Ensure notification is hidden
      setError(null); // Clear any error messages
    }
  };

  const copyMatchIdToClipboard = () => {
    if (currentMatchId) {
      navigator.clipboard.writeText(currentMatchId)
        .then(() => {
          // You could add a visual confirmation here if desired
          console.log('Match ID copied to clipboard');
        })
        .catch(err => {
          console.error('Failed to copy match ID:', err);
        });
    }
  };

  // Add a helper function to get player names
  const getPlayerNameWithRole = (role: 'player1' | 'player2') => {
    if (!currentMatchId) {
      return role === 'player1' ? 'Player 1' : 'Player 2';
    }
    
    // Find match data from the global store
    const match = (window as any).activeMatches?.find((m: any) => m.id === currentMatchId);
    if (match) {
      const name = role === 'player1' ? match.player1 : match.player2;
      if (name) {
        return `${name} (${role === 'player1' ? 'Player 1' : 'Player 2'})`;
      }
    }
    
    return role === 'player1' ? 'Player 1' : 'Player 2';
  };

  // Add a useEffect to monitor the notification state
  useEffect(() => {
    console.log('Notification state changed:', showJoinNotification);
  }, [showJoinNotification]);

  if (loading) {
    return <div className="app-container loading">Loading...</div>;
  }

  if (error) {
    // Only show retry button for connection errors
    if (error === 'Failed to connect to server') {
      return (
        <div className="app-container error">
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      );
    }
    // For game-related messages, just show the message
    return (
      <div className="app-container error">
        <p>{error}</p>
      </div>
    );
  }

  if (currentScreen === 'lobby') {
    return <Lobby onJoinMatch={handleJoinMatch} />;
  }

  return (
    <div className="app-container">
      {showJoinNotification && (
        <div className="join-notification">
          Player 2 has joined the match!
        </div>
      )}
    
      <header>
        <h1>Archess</h1>
        <div className="header-right">
          {currentPlayer && (
            <div className={`current-player player-${currentPlayer}`}>
              Playing as: {getPlayerNameWithRole(currentPlayer as 'player1' | 'player2')}
            </div>
          )}
          <button onClick={handleExitMatch}>Exit Match</button>
          <button onClick={resetGame}>Reset Game</button>
        </div>
      </header>
      
      <main>
        {gameState && (
          <>
            <div className="match-info-panel">
              <div className="match-id">
                <span className="label">Match ID:</span> 
                <span className="id-value" onClick={copyMatchIdToClipboard} title="Click to copy">
                  {currentMatchId}
                </span>
              </div>
              
              <div className={`turn-indicator ${gameState.currentTurn === currentPlayer ? 'your-turn' : ''}`}>
                {gameState.currentTurn === currentPlayer ? (
                  <span>Your Turn</span>
                ) : (
                  <span>Waiting for {getPlayerNameWithRole(gameState.currentTurn as 'player1' | 'player2')}</span>
                )}
              </div>
            </div>
            
            {currentPlayer === 'player1' && gameState.players.length < 2 && (
              <div className="waiting-banner">
                Waiting for Player 2 to join...
              </div>
            )}
            
            <GameBoard 
              gameState={gameState} 
              networkManager={networkManagerRef.current} 
              currentPlayer={currentPlayer}
              matchId={currentMatchId}
            />
          </>
        )}
      </main>
    </div>
  );
}

export default App; 