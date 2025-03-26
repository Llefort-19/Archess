import React from 'react';
import './PlayerSelection.css';

interface PlayerSelectionProps {
  onSelectPlayer: (playerId: string) => void;
}

const PlayerSelection: React.FC<PlayerSelectionProps> = ({ onSelectPlayer }) => {
  return (
    <div className="player-selection">
      <h2>Select Your Player</h2>
      <div className="players">
        <div 
          className="player player-1" 
          onClick={() => onSelectPlayer('player1')}
        >
          <div className="player-icon" style={{ backgroundColor: '#3498db' }}>P1</div>
          <div className="player-name">Player 1</div>
        </div>
        <div 
          className="player player-2" 
          onClick={() => onSelectPlayer('player2')}
        >
          <div className="player-icon" style={{ backgroundColor: '#e74c3c' }}>P2</div>
          <div className="player-name">Player 2</div>
        </div>
      </div>
      <p className="instruction">Choose which player you want to control</p>
    </div>
  );
};

export default PlayerSelection; 