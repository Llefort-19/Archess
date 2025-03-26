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
          // Only update if state is for the current match
          if (currentMatchId && (state as any).matchId === currentMatchId) {
            setGameState(state);
          } else if (!currentMatchId) {
            // If we're not in a match yet, update anyway (for initial state)
            setGameState(state);
          }
          
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

    // Only disconnect when component unmounts, not on dependency changes
    return () => {
      if (connectionInitializedRef.current) {
        networkManager.disconnect();
        connectionInitializedRef.current = false;
      }
    };
  }, []); // Empty dependency array - only run on mount/unmount

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
      
      // Now fetch the game state
      const response = await fetch(`http://localhost:4000/api/game/${matchId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch game state: ${response.status}`);
      }
      
      const gameState = await response.json();
      setGameState(gameState);
      
      // IMPORTANT: Finally transition to game screen
      setCurrentScreen('game');
      setLoading(false);
    } catch (error) {
      console.error('Error joining match:', error);
      setError(`Failed to join match: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setLoading(false);
    }
  };

  const handleExitMatch = () => {
    // Reset match-specific state but don't disconnect
    setCurrentScreen('lobby');
    setCurrentMatchId(null);
    setCurrentPlayer(null);
    setGameState(null);
  };

  if (loading) {
    return <div className="app-container loading">Loading...</div>;
  }

  if (error) {
    return (
      <div className="app-container error">
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  if (currentScreen === 'lobby') {
    return <Lobby onJoinMatch={handleJoinMatch} />;
  }

  return (
    <div className="app-container">
      <header>
        <h1>Archess</h1>
        <div className="header-right">
          {currentPlayer && (
            <div className="current-player">
              Playing as: {currentPlayer}
            </div>
          )}
          <button onClick={handleExitMatch}>Exit Match</button>
          <button onClick={resetGame}>Reset Game</button>
        </div>
      </header>
      
      <main>
        {gameState && (
          <>
            <div className="game-info">
              <p>Current Turn: {gameState.currentTurn}</p>
              <p>Match ID: {currentMatchId}</p>
            </div>
            
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