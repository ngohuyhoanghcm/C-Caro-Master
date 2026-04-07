/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { RotateCcw, Trophy, User, Hash, Globe, Copy, Check, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';

const BOARD_SIZE = 15;
const WIN_COUNT = 5;

type Player = 'X' | 'O';
type CellValue = Player | null;
type GameMode = 'PvP' | 'PvE' | 'Online';
type Difficulty = 'Easy' | 'Medium' | 'Hard';

export default function App() {
  const [gameState, setGameState] = useState<{
    board: CellValue[];
    lastMoveIndex: number | null;
  }>({
    board: Array(BOARD_SIZE * BOARD_SIZE).fill(null),
    lastMoveIndex: null
  });
  const [currentPlayer, setCurrentPlayer] = useState<Player>('X');
  const [winner, setWinner] = useState<Player | 'Draw' | null>(null);
  const [winningLine, setWinningLine] = useState<number[]>([]);
  const [useCaroRules, setUseCaroRules] = useState(true);
  const [gameMode, setGameMode] = useState<GameMode>('PvE');
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const aiProcessing = useRef(false);
  const lastProcessedIndex = useRef<number | null>(null);

  // Online Multiplayer States
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomID, setRoomID] = useState<string | null>(null);
  const [inputRoomID, setInputRoomID] = useState('');
  const [mySymbol, setMySymbol] = useState<Player | null>(null);
  const [isOnlineGameStarted, setIsOnlineGameStarted] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rematchStatus, setRematchStatus] = useState<'none' | 'requested' | 'waiting'>('none');

  // Sound Effects using Web Audio API
  const playSound = useCallback((type: 'place' | 'win' | 'draw') => {
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AudioContextClass) return;
    
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'place') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'win') {
      osc.type = 'triangle';
      // Simple arpeggio
      [440, 554.37, 659.25, 880].forEach((freq, i) => {
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
      });
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0.1, now + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    } else if (type === 'draw') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.linearRampToValueAtTime(150, now + 0.3);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  }, []);

  const joinRoom = (id?: string) => {
    const targetID = id || inputRoomID || Math.random().toString(36).substring(2, 8).toUpperCase();
    if (socket) {
      socket.emit('joinRoom', targetID);
    }
  };

  const copyRoomID = () => {
    if (roomID) {
      navigator.clipboard.writeText(roomID);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  const getAiMove = useCallback((currentBoard: CellValue[]) => {
    const emptyIndices = currentBoard.map((val, idx) => val === null ? idx : null).filter((val): val is number => val !== null);
    
    if (emptyIndices.length === 0) return -1;

    // Easy mode: 40% chance of a completely random move
    if (difficulty === 'Easy' && Math.random() < 0.4) {
      return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
    }

    let bestScore = -Infinity;
    let candidates: number[] = [];

    const scorePattern = (count: number, openEnds: number) => {
      if (count >= 5) return 100000;
      if (count === 4) {
        if (openEnds === 2) return 10000;
        if (openEnds === 1) return 1000;
      }
      if (count === 3) {
        if (openEnds === 2) return 1000;
        if (openEnds === 1) return 100;
      }
      if (count === 2) {
        if (openEnds === 2) return 100;
        if (openEnds === 1) return 10;
      }
      return count;
    };

    const evaluatePos = (idx: number, player: Player) => {
      const row = Math.floor(idx / BOARD_SIZE);
      const col = idx % BOARD_SIZE;
      const opponent = player === 'X' ? 'O' : 'X';
      let totalScore = 0;

      const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

      for (const [dr, dc] of directions) {
        let count = 1;
        let openEnds = 0;

        // Forward
        for (let i = 1; i < 5; i++) {
          const r = row + dr * i, c = col + dc * i;
          if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
            if (currentBoard[r * BOARD_SIZE + c] === player) count++;
            else {
              if (currentBoard[r * BOARD_SIZE + c] === null) openEnds++;
              break;
            }
          } else break;
        }
        // Backward
        for (let i = 1; i < 5; i++) {
          const r = row - dr * i, c = col - dc * i;
          if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
            if (currentBoard[r * BOARD_SIZE + c] === player) count++;
            else {
              if (currentBoard[r * BOARD_SIZE + c] === null) openEnds++;
              break;
            }
          } else break;
        }
        totalScore += scorePattern(count, openEnds);
      }
      return totalScore;
    };

    // Adjust weights based on difficulty
    const defenseWeight = difficulty === 'Hard' ? 1.5 : (difficulty === 'Medium' ? 1.1 : 0.8);

    for (const idx of emptyIndices) {
      const aiScore = evaluatePos(idx, 'O');
      const humanScore = evaluatePos(idx, 'X');
      
      const score = aiScore + humanScore * defenseWeight;

      if (score > bestScore) {
        bestScore = score;
        candidates = [idx];
      } else if (score === bestScore) {
        candidates.push(idx);
      }
    }

    // Return a random choice among the best scoring moves for variety
    return candidates[Math.floor(Math.random() * candidates.length)];
  }, [difficulty]);

  const checkWinner = useCallback((board: CellValue[], index: number) => {
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    const player = board[index];
    const opponent = player === 'X' ? 'O' : 'X';

    if (!player) return null;

    const directions = [
      [0, 1],  // Horizontal
      [1, 0],  // Vertical
      [1, 1],  // Diagonal \
      [1, -1], // Diagonal /
    ];

    for (const [dr, dc] of directions) {
      let line = [index];
      
      // Check forward
      let forwardBlocked = false;
      for (let i = 1; i < BOARD_SIZE; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
          if (board[r * BOARD_SIZE + c] === player) {
            line.push(r * BOARD_SIZE + c);
          } else {
            if (board[r * BOARD_SIZE + c] === opponent) forwardBlocked = true;
            break;
          }
        } else {
          break;
        }
      }

      // Check backward
      let backwardBlocked = false;
      for (let i = 1; i < BOARD_SIZE; i++) {
        const r = row - dr * i;
        const c = col - dc * i;
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
          if (board[r * BOARD_SIZE + c] === player) {
            line.push(r * BOARD_SIZE + c);
          } else {
            if (board[r * BOARD_SIZE + c] === opponent) backwardBlocked = true;
            break;
          }
        } else {
          break;
        }
      }

      if (line.length >= 5) {
        // Caro rules: blocked at both ends means no win
        if (useCaroRules && line.length === 5 && forwardBlocked && backwardBlocked) {
          continue;
        }
        return { player, line };
      }
    }

    if (!board.includes(null)) return { player: 'Draw' as const, line: [] };
    return null;
  }, [useCaroRules]);

  const handleCellClick = useCallback((index: number, symbol: Player, isRemote = false) => {
    if (winner || gameState.board[index]) return;

    // Validation for PvE
    if (gameMode === 'PvE' && !isRemote && (currentPlayer === 'O' || aiProcessing.current)) return;
    
    // Validation for Online
    if (gameMode === 'Online' && !isRemote) {
      if (!isOnlineGameStarted || currentPlayer !== mySymbol) return;
    }

    // Atomic update of board and last move
    const newBoard = [...gameState.board];
    newBoard[index] = symbol;
    
    setGameState({ board: newBoard, lastMoveIndex: index });
    playSound('place');

    // Check for winner
    const result = checkWinner(newBoard, index);
    if (result) {
      setWinner(result.player);
      setWinningLine(result.line);
      if (result.player === 'Draw') playSound('draw');
      else playSound('win');
      setIsAiThinking(false);
      aiProcessing.current = false;
    } else {
      const nextPlayer = symbol === 'X' ? 'O' : 'X';
      setCurrentPlayer(nextPlayer);
      if (nextPlayer === 'X') {
        setIsAiThinking(false);
        aiProcessing.current = false;
      }
    }

    // Online sync
    if (gameMode === 'Online' && !isRemote && socket && roomID) {
      socket.emit('makeMove', { roomID, index, symbol });
    }
  }, [winner, gameState.board, gameMode, currentPlayer, isOnlineGameStarted, mySymbol, socket, roomID, checkWinner, playSound]);

  // AI Move Effect
  useEffect(() => {
    if (gameMode === 'PvE' && currentPlayer === 'O' && !winner && !aiProcessing.current) {
      aiProcessing.current = true;
      setIsAiThinking(true);
      
      const timer = setTimeout(() => {
        // Double check condition before moving
        if (currentPlayer !== 'O' || winner) {
          aiProcessing.current = false;
          setIsAiThinking(false);
          return;
        }

        const move = getAiMove(gameState.board);
        if (move !== -1) {
          handleCellClick(move, 'O', true);
        } else {
          setIsAiThinking(false);
          aiProcessing.current = false;
        }
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [currentPlayer, gameMode, winner, gameState.board, getAiMove, handleCellClick]);

  // Update opponentMove listener to use handleCellClick
  useEffect(() => {
    if (!socket) return;
    
    const handleOpponentMove = ({ index, symbol }: { index: number, symbol: Player }) => {
      handleCellClick(index, symbol, true);
      playSound('place');
    };

    socket.on('opponentMove', handleOpponentMove);
    return () => { socket.off('opponentMove', handleOpponentMove); };
  }, [socket, handleCellClick, playSound]);

  const resetGame = useCallback((notifyServer = true) => {
    setGameState({
      board: Array(BOARD_SIZE * BOARD_SIZE).fill(null),
      lastMoveIndex: null
    });
    setCurrentPlayer('X');
    setWinner(null);
    setWinningLine([]);
    setIsAiThinking(false);
    aiProcessing.current = false;
    lastProcessedIndex.current = null;
    
    if (gameMode === 'Online' && notifyServer && socket && roomID) {
      socket.emit('resetGame', roomID);
      setRematchStatus('waiting');
    }
  }, [gameMode, socket, roomID]);

  // Socket initialization
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);
    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Socket listeners
  useEffect(() => {
    if (!socket) return;

    const onPlayerAssigned = ({ symbol, roomID }: { symbol: Player, roomID: string }) => {
      setMySymbol(symbol);
      setRoomID(roomID);
      setOnlineError(null);
    };

    const onGameStarted = () => {
      setIsOnlineGameStarted(true);
      resetGame();
    };

    const onGameReset = () => {
      resetGame(false);
      setRematchStatus('none');
    };

    const onRematchRequested = () => {
      setRematchStatus('requested');
    };

    const onRematchDeclined = () => {
      setRematchStatus('none');
      setOnlineError('Đối thủ đã từ chối đấu lại.');
    };

    const onOpponentDisconnected = () => {
      setOnlineError('Đối thủ đã thoát phòng.');
      setIsOnlineGameStarted(false);
      setWinner(null);
      setRematchStatus('none');
    };

    const onError = (msg: string) => {
      setOnlineError(msg);
    };

    socket.on('playerAssigned', onPlayerAssigned);
    socket.on('gameStarted', onGameStarted);
    socket.on('gameReset', onGameReset);
    socket.on('rematchRequested', onRematchRequested);
    socket.on('rematchDeclined', onRematchDeclined);
    socket.on('opponentDisconnected', onOpponentDisconnected);
    socket.on('error', onError);

    return () => {
      socket.off('playerAssigned', onPlayerAssigned);
      socket.off('gameStarted', onGameStarted);
      socket.off('gameReset', onGameReset);
      socket.off('rematchRequested', onRematchRequested);
      socket.off('rematchDeclined', onRematchDeclined);
      socket.off('opponentDisconnected', onOpponentDisconnected);
      socket.off('error', onError);
    };
  }, [socket, resetGame]);

  const handleAcceptRematch = () => {
    if (socket && roomID) {
      socket.emit('acceptRematch', roomID);
    }
  };

  const handleDeclineRematch = () => {
    if (socket && roomID) {
      socket.emit('declineRematch', roomID);
      setRematchStatus('none');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans text-slate-900">
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <h1 className="text-4xl font-bold tracking-tight text-slate-800 mb-2 flex items-center justify-center gap-3">
          <Hash className="text-indigo-600" /> Cờ Caro Master
        </h1>
        <p className="text-slate-500 font-medium">Thử thách trí tuệ với Gomoku</p>
      </motion.div>

      {/* Status Bar */}
      <div className="w-full max-w-md mb-6 flex flex-col gap-4">
        <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-100">
          <button 
            onClick={() => { setGameMode('PvE'); resetGame(false); setRoomID(null); setIsOnlineGameStarted(false); }}
            className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${gameMode === 'PvE' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Đấu với Máy
          </button>
          <button 
            onClick={() => { setGameMode('PvP'); resetGame(false); setRoomID(null); setIsOnlineGameStarted(false); }}
            className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${gameMode === 'PvP' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Offline
          </button>
          <button 
            onClick={() => { setGameMode('Online'); resetGame(false); }}
            className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${gameMode === 'Online' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Online
          </button>
        </div>

        {gameMode === 'Online' && !roomID && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-3"
          >
            <p className="text-sm font-bold text-slate-600">Chế độ Online</p>
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="Mã phòng..."
                value={inputRoomID}
                onChange={(e) => setInputRoomID(e.target.value.toUpperCase())}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button 
                onClick={() => joinRoom()}
                className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors"
              >
                Vào phòng
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-px bg-slate-100 flex-1" />
              <span className="text-[10px] text-slate-400 font-bold uppercase">Hoặc</span>
              <div className="h-px bg-slate-100 flex-1" />
            </div>
            <button 
              onClick={() => joinRoom()}
              className="w-full bg-slate-100 text-slate-600 py-2 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
            >
              <Globe className="w-4 h-4" /> Tạo phòng mới
            </button>
          </motion.div>
        )}

        {gameMode === 'Online' && roomID && !isOnlineGameStarted && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100 text-center flex flex-col items-center gap-4"
          >
            <div className="relative">
              <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center">
                <Users className="w-8 h-8 text-indigo-600" />
              </div>
              <motion.div 
                animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute -inset-2 border-2 border-indigo-200 rounded-full"
              />
            </div>
            <div>
              <h3 className="font-bold text-indigo-900 text-lg">Đang chờ đối thủ...</h3>
              <p className="text-sm text-indigo-600/70 mt-1">Gửi mã phòng này cho bạn bè để bắt đầu trận đấu</p>
            </div>
            <div className="flex items-center gap-2 bg-white px-5 py-3 rounded-xl border border-indigo-200 shadow-sm group cursor-pointer" onClick={copyRoomID}>
              <span className="font-mono font-bold text-indigo-600 tracking-widest text-lg">{roomID}</span>
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-indigo-50 group-hover:bg-indigo-100 transition-colors">
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-indigo-400" />}
              </div>
            </div>
            {onlineError && (
              <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs text-rose-500 font-bold bg-rose-50 px-3 py-1 rounded-full border border-rose-100"
              >
                {onlineError}
              </motion.p>
            )}
          </motion.div>
        )}

        {onlineError && gameMode === 'Online' && isOnlineGameStarted && (
          <div className="bg-rose-50 p-3 rounded-xl border border-rose-100 text-rose-600 text-xs font-medium text-center">
            {onlineError}
          </div>
        )}

        {gameMode === 'PvE' && (
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            {(['Easy', 'Medium', 'Hard'] as Difficulty[]).map((level) => (
              <button
                key={level}
                onClick={() => { setDifficulty(level); resetGame(); }}
                className={`flex-1 py-1.5 rounded-lg font-bold text-xs transition-all ${difficulty === level ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {level === 'Easy' ? 'Dễ' : level === 'Medium' ? 'Trung bình' : 'Khó'}
              </button>
            ))}
          </div>
        )}

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between relative overflow-hidden">
          {isAiThinking && (
            <motion.div 
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              className="absolute bottom-0 left-0 h-1 bg-indigo-400 w-full opacity-50"
            />
          )}

          <div className={`flex items-center gap-3 transition-all duration-300 ${currentPlayer === 'X' && !winner ? 'scale-110' : 'opacity-50'}`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${currentPlayer === 'X' && !winner ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-slate-100 text-slate-400'}`}>
              <span className="font-bold text-xl">X</span>
            </div>
            <div className="text-left">
              <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">
                {gameMode === 'Online' ? (mySymbol === 'X' ? 'Bạn' : 'Đối thủ') : 'Người chơi 1'}
              </p>
              <p className="font-semibold">{gameMode === 'Online' && mySymbol === 'X' ? 'Bạn (X)' : 'Player X'}</p>
            </div>
          </div>

          <div className="h-8 w-px bg-slate-100" />

          <div className={`flex items-center gap-3 transition-all duration-300 ${currentPlayer === 'O' && !winner ? 'scale-110' : 'opacity-50'}`}>
            <div className="text-right">
              <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">
                {gameMode === 'PvE' ? 'Máy' : (gameMode === 'Online' ? (mySymbol === 'O' ? 'Bạn' : 'Đối thủ') : 'Người chơi 2')}
              </p>
              <p className="font-semibold">{gameMode === 'PvE' ? 'AI Bot' : (gameMode === 'Online' && mySymbol === 'O' ? 'Bạn (O)' : 'Player O')}</p>
            </div>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${currentPlayer === 'O' && !winner ? 'bg-rose-500 text-white shadow-lg shadow-rose-200' : 'bg-slate-100 text-slate-400'}`}>
              <span className="font-bold text-xl">O</span>
            </div>
          </div>
        </div>
      </div>

      {/* Board Container */}
      <div className="relative group">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-2 rounded-xl shadow-2xl border-4 border-slate-200 overflow-hidden"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
            width: 'min(90vw, 500px)',
            height: 'min(90vw, 500px)',
          }}
        >
          {gameState.board.map((cell, i) => (
            <button
              key={i}
              onClick={() => handleCellClick(i, currentPlayer)}
              disabled={!!cell || !!winner || (gameMode === 'PvE' && (currentPlayer === 'O' || isAiThinking))}
              className={`
                relative border border-slate-100 flex items-center justify-center
                transition-all duration-200 text-lg sm:text-xl font-bold
                ${!cell && !winner ? 'hover:bg-indigo-50 cursor-pointer' : 'cursor-default'}
                ${winningLine.includes(i) ? 'bg-green-100 z-10' : ''}
                ${gameState.lastMoveIndex === i && !winner ? 'bg-indigo-50/50' : ''}
              `}
            >
              {winningLine.includes(i) && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ 
                    repeat: Infinity, 
                    repeatType: "reverse", 
                    duration: 0.8,
                    delay: winningLine.indexOf(i) * 0.1
                  }}
                  className="absolute inset-0 bg-green-400/20 pointer-events-none"
                />
              )}
              <AnimatePresence mode="popLayout">
                {cell && (
                  <motion.span
                    key={`${i}-${cell}`}
                    initial={{ scale: 0, rotate: -45, opacity: 0 }}
                    animate={{ 
                      scale: 1, 
                      rotate: 0, 
                      opacity: 1 
                    }}
                    transition={{ 
                      type: "spring", 
                      stiffness: 300, 
                      damping: 12 
                    }}
                    className={cell === 'X' ? 'text-indigo-600' : 'text-rose-500'}
                  >
                    {cell}
                  </motion.span>
                )}
              </AnimatePresence>
              
              {/* Last move indicator dot */}
              {gameState.lastMoveIndex === i && !winner && (
                <motion.div 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-400"
                />
              )}

              {/* Grid Lines helper for visual polish */}
              <div className="absolute inset-0 pointer-events-none opacity-10 border-[0.5px] border-slate-400" />
            </button>
          ))}
        </motion.div>

        {/* Winner Overlay */}
        <AnimatePresence>
          {winner && (
            <motion.div 
              initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
              animate={{ opacity: 1, backdropFilter: 'blur(4px)' }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-xl bg-white/60"
            >
              <motion.div
                initial={{ scale: 0.5, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white p-8 rounded-3xl shadow-2xl border border-slate-100 text-center"
              >
                <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trophy className="w-10 h-10 text-yellow-600" />
                </div>
                <h2 className="text-3xl font-bold text-slate-800 mb-2">
                  {winner === 'Draw' ? 'Hòa rồi!' : (
                    gameMode === 'Online' 
                      ? (winner === mySymbol ? `Chúc mừng! Bạn (${winner}) đã thắng!` : `Rất tiếc! Đối thủ (${winner}) đã thắng!`)
                      : `Chúc mừng Người chơi ${winner}, bạn đã thắng!`
                  )}
                </h2>
                <p className="text-slate-500 mb-6">Một trận đấu tuyệt vời!</p>
                
                <div className="flex flex-col gap-3">
                  {rematchStatus === 'none' && (
                    <button
                      onClick={() => resetGame()}
                      className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                    >
                      <RotateCcw className="w-5 h-5" /> Chơi lại
                    </button>
                  )}

                  {rematchStatus === 'waiting' && (
                    <div className="bg-slate-50 px-8 py-3 rounded-xl border border-slate-200 text-slate-500 font-bold flex items-center gap-3">
                      <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      Đang chờ đối thủ đồng ý...
                    </div>
                  )}

                  {rematchStatus === 'requested' && (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm font-bold text-indigo-600 animate-bounce">Đối thủ muốn đấu lại!</p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleAcceptRematch}
                          className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-indigo-700 transition-colors"
                        >
                          Đồng ý
                        </button>
                        <button
                          onClick={handleDeclineRematch}
                          className="flex-1 bg-slate-100 text-slate-600 px-4 py-2 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                        >
                          Từ chối
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div className="mt-8 flex flex-col items-center gap-4">
        <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm">
          <span className="text-sm font-medium text-slate-600">Luật chặn 2 đầu:</span>
          <button 
            onClick={() => setUseCaroRules(!useCaroRules)}
            className={`w-12 h-6 rounded-full transition-colors relative ${useCaroRules ? 'bg-indigo-600' : 'bg-slate-200'}`}
          >
            <motion.div 
              animate={{ x: useCaroRules ? 24 : 4 }}
              className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
            />
          </button>
        </div>

        {!winner && (
          <button
            onClick={resetGame}
            className="flex items-center gap-2 bg-white text-slate-600 px-6 py-3 rounded-xl font-semibold hover:bg-slate-100 transition-all border border-slate-200 shadow-sm"
          >
            <RotateCcw className="w-5 h-5" /> Làm mới bàn cờ
          </button>
        )}
      </div>

      {/* Footer Info */}
      <div className="mt-12 text-slate-400 text-sm flex flex-col items-center gap-2">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-indigo-600" /> Player X</span>
          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-rose-500" /> Player O</span>
        </div>
        <p>© 2026 Gomoku Master • 15x15 Grid</p>
      </div>
    </div>
  );
}
