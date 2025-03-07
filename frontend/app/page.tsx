'use client'

import { useState, useEffect, useRef } from 'react'
import { default as Navbar } from './components/Navbar'
import TaskCard from './components/TaskCard'
import TimerPill from './components/TimerPill'
import { Task, TimerState, Subtask } from './types'
import { v4 as uuidv4 } from 'uuid'
import { motion, AnimatePresence } from 'framer-motion'
import { config } from './config'
import { useAuth } from '../contexts/AuthContext'
import { useApi } from '../hooks/useApi'

export default function Home() {
  const { user, loading, signIn } = useAuth()
  const { updateTaskCompletion, updateSubtaskCompletion, createTask, createSubtask, getTodaysTasks } = useApi()
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<{
    taskId: string;
    subtaskId?: string;
    is_completed: boolean;
  }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [hasStartedPlanning, setHasStartedPlanning] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [timerState, setTimerState] = useState<TimerState>({
    taskId: null,
    subtaskId: null,
    startTime: null,
    timeRemaining: 0,
    isRunning: false
  });
  const [isCompletedVisible, setIsCompletedVisible] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !hasStartedPlanning && userInput.trim()) {
        e.preventDefault();
        handlePlanDay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [userInput, hasStartedPlanning]);

  useEffect(() => {
    const loadUserTasks = async () => {
      if (!user) {
        console.log('No user found, skipping task load');
        setIsLoading(false);
        setTasks([]);
        setHasStartedPlanning(false);
        setPendingUpdates([]);
        setUserInput('');
        setTimerState({
          taskId: null,
          subtaskId: null,
          startTime: null,
          timeRemaining: 0,
          isRunning: false
        });
        setIsCompletedVisible(false);
        return;
      }
      
      try {
        setIsLoading(true);
        console.log('Loading tasks for user:', {
          userId: user.id,
          email: user.email,
          authStatus: 'authenticated'
        });

        const userTasks = await getTodaysTasks(user.id);
        
        if (Array.isArray(userTasks) && userTasks.length > 0) {
          console.log('Found tasks for today:', {
            count: userTasks.length,
            userId: user.id
          });
          setTasks(userTasks);
          setHasStartedPlanning(true);
          // Clear any saved planning state since we have tasks
          localStorage.removeItem(`userInput_${user.id}`);
          localStorage.removeItem(`hasStartedPlanning_${user.id}`);
        } else {
          console.log('No tasks found for today:', {
            userId: user.id,
            authStatus: 'authenticated'
          });
          setTasks([]);
          setPendingUpdates([]);
          // Only restore saved state if we don't have tasks
          const savedUserInput = localStorage.getItem(`userInput_${user.id}`);
          const savedHasStartedPlanning = localStorage.getItem(`hasStartedPlanning_${user.id}`);
          if (savedUserInput) {
            console.log('Restoring saved user input');
            setUserInput(savedUserInput);
          }
          if (savedHasStartedPlanning) {
            console.log('Restoring saved planning state');
            setHasStartedPlanning(JSON.parse(savedHasStartedPlanning));
          } else {
            console.log('No saved state found, showing planning page');
            setHasStartedPlanning(false);
          }
        }
      } catch (error) {
        console.error('Error loading user tasks:', {
          error,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          errorStack: error instanceof Error ? error.stack : undefined,
          userId: user.id,
          email: user.email,
          authStatus: 'authenticated'
        });
        // On error, reset to initial state
        setTasks([]);
        setHasStartedPlanning(false);
        setPendingUpdates([]);
        setUserInput('');
      } finally {
        setIsLoading(false);
      }
    };

    // Reset state when user changes
    if (!user) {
      console.log('User logged out, clearing state');
      setTasks([]);
      setHasStartedPlanning(false);
      setUserInput('');
      setPendingUpdates([]);
      setTimerState({
        taskId: null,
        subtaskId: null,
        startTime: null,
        timeRemaining: 0,
        isRunning: false
      });
      setIsCompletedVisible(false);
    } else {
      console.log('User state changed:', {
        userId: user.id,
        email: user.email,
        authStatus: 'authenticated'
      });
    }

    loadUserTasks();
  }, [user, getTodaysTasks]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (timerState.isRunning && timerState.taskId) {
      interval = setInterval(() => {
        setTimerState(prev => ({
          ...prev,
          timeRemaining: Math.max(0, prev.timeRemaining - 1)
        }));

        setTasks(prev => prev.map(task => 
          task.id === timerState.taskId
            ? {
                ...task,
                timeRemaining: task.timeRemaining ? Math.max(0, task.timeRemaining - 1) : 0,
                subtasks: task.subtasks?.map(s => ({
                  ...s,
                  timeRemaining: s.id === timerState.subtaskId && s.timeRemaining 
                    ? Math.max(0, s.timeRemaining - 1)
                    : s.timeRemaining
                }))
              }
            : task
        ));
      }, 1000);
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [timerState.isRunning, timerState.taskId]);

  const handlePlanDay = async () => {
    if (!userInput.trim() || !user) return;
    
    setIsLoading(true)
    
    try {
      // Get today's date in local timezone
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0'); // Add 1 because months are 0-indexed
      const day = String(today.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;
      
      console.log('Creating tasks for date:', formattedDate, 'in timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);

      const response = await fetch(`${config.apiBaseUrl}/api/plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          prompt: userInput,
          user_id: user.id,
          date: formattedDate
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Server error:', errorData);
        throw new Error(`Failed to plan tasks: ${errorData.detail || 'Unknown error'}`);
      }

      const data = await response.json();
      if (!data.tasks) {
        console.error('Invalid response format:', data);
        throw new Error('Invalid response from server');
      }

      // Tasks are already saved in Supabase by the backend
      setTasks(data.tasks);
      setHasStartedPlanning(true);
    } catch (error) {
      console.error('Error planning tasks:', {
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTaskUpdate = async (updatedTask: Task) => {
    // If completion status has changed, add to pending updates
    const existingTask = tasks.find(t => t.id === updatedTask.id);
    if (existingTask && existingTask.is_completed !== updatedTask.is_completed) {
      // Add task update
      const updates = [{
        taskId: updatedTask.id,
        is_completed: updatedTask.is_completed || false
      }];
      
      // Add subtask updates if task has subtasks
      const subtasks = updatedTask.subtasks || [];
      if (subtasks.length > 0) {
        updates.push(
          ...subtasks.map(subtask => ({
            taskId: updatedTask.id,
            subtaskId: subtask.id,
            is_completed: updatedTask.is_completed || false
          }))
        );
      }

      setPendingUpdates(prev => [...prev, ...updates]);
    }

    // Update local state
    setTasks(prev => prev.map(task => 
      task.id === updatedTask.id ? updatedTask : task
    ));
  };

  const handleGenerateSubtasks = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    setIsLoading(true);
    
    try {
      console.log('Generating subtasks for task:', {
        taskId,
        name: task.name,
        description: task.description
      });

      const response = await fetch(`${config.apiBaseUrl}/api/generate-subtasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task_id: task.id,
          name: task.name,
          description: task.description,
          duration_minutes: task.duration_minutes
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Failed to generate subtasks: ${errorData.detail || 'Unknown error'}`);
      }

      const data = await response.json();
      console.log('Received subtasks from API:', data.subtasks);
      
      // Update task with generated subtasks
      setTasks(prev => prev.map(t => 
        t.id === taskId
          ? { 
              ...t, 
              subtasks: data.subtasks.map((subtask: Subtask) => ({
                ...subtask,
                isTimerRunning: false,
                timeRemaining: subtask.duration_minutes * 60
              })), 
              hasSubtasks: true 
            }
          : t
      ));

    } catch (error) {
      console.error('Error generating subtasks:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        taskId
      });
      // Don't throw the error, just log it
    } finally {
      setIsLoading(false);
    }
  };

  const handleTimerClick = (taskId: string, subtaskId?: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const subtask = subtaskId && task.subtasks?.find(s => s.id === subtaskId);
    const duration = subtask ? subtask.duration_minutes : task.duration_minutes;

    if (task.isTimerRunning) {
      if (timerState.taskId === taskId && timerState.timeRemaining === 0) {
        setTimerState({
          taskId: null,
          subtaskId: null,
          startTime: null,
          timeRemaining: 0,
          isRunning: false
        });
        setTasks(prev => prev.map(t => 
          t.id === taskId
            ? {
                ...t,
                isTimerRunning: false,
                timeRemaining: duration * 60,
                subtasks: t.subtasks?.map(s => ({
                  ...s,
                  isTimerRunning: false,
                  timeRemaining: s.duration_minutes * 60
                }))
              }
            : t
        ));
      } else {
        setTimerState(prev => ({
          ...prev,
          isRunning: !prev.isRunning
        }));
      }
    } else {
      setTimerState({
        taskId,
        subtaskId: subtaskId || null,
        startTime: Date.now(),
        timeRemaining: duration * 60,
        isRunning: true
      });

      setTasks(prev => prev.map(t => 
        t.id === taskId
          ? {
              ...t,
              isTimerRunning: true,
              timeRemaining: duration * 60,
              subtasks: t.subtasks?.map(s => ({
                ...s,
                isTimerRunning: s.id === subtaskId,
                timeRemaining: s.duration_minutes * 60
              }))
            }
          : t
      ));
    }
  };

  const handleTimerComplete = (taskId: string, subtaskId?: string) => {
    setTimerState({
      taskId: null,
      subtaskId: null,
      startTime: null,
      timeRemaining: 0,
      isRunning: false
    });

    setTasks(prev => prev.map(t => 
      t.id === taskId
        ? {
            ...t,
            isTimerRunning: false,
            timeRemaining: t.duration_minutes * 60,
            subtasks: t.subtasks?.map(s => ({
              ...s,
              isTimerRunning: false,
              timeRemaining: s.duration_minutes * 60,
              is_completed: s.id === subtaskId ? true : s.is_completed
            }))
          }
        : t
    ));
  };

  const handleReset = async () => {
    // Save any pending updates before resetting
    if (pendingUpdates.length > 0) {
      try {
        await Promise.all(
          pendingUpdates.map(async (update) => {
            if (update.subtaskId) {
              await updateSubtaskCompletion(update.subtaskId, update.is_completed);
            } else {
              await updateTaskCompletion(update.taskId, update.is_completed);
            }
          })
        );
        setPendingUpdates([]);
      } catch (error) {
        console.error('Error saving completion updates:', error);
      }
    }

    setHasStartedPlanning(false);
    setTasks([]);
    setUserInput('');
    
    // Clear user-specific localStorage
    if (user) {
      localStorage.removeItem(`userInput_${user.id}`);
      localStorage.removeItem(`hasStartedPlanning_${user.id}`);
    }
  };

  const startSpeechRecognition = async () => {
    try {
      // Request microphone permission first
      const permission = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // If we got here, permission was granted
      // Stop the audio stream as we don't need it anymore
      permission.getTracks().forEach(track => track.stop());

      // Create new recognition instance
      recognitionRef.current = new (window as any).webkitSpeechRecognition();
      const recognition = recognitionRef.current;
      
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      
      recognition.onstart = () => {
        console.log('Speech recognition started');
        setIsRecording(true);
      };
      
      recognition.onend = () => {
        console.log('Speech recognition ended');
        setIsRecording(false);
      };
      
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
      };
      
      recognition.onresult = (event: any) => {
        console.log('Speech recognition result received');
        const transcript = event.results[0][0].transcript;
        console.log('Transcript:', transcript);
        setUserInput(prev => prev + (prev ? ' ' : '') + transcript);
      };
      
      recognition.start();
    } catch (error) {
      console.error('Error initializing speech recognition:', error);
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        alert('Please allow microphone access to use voice input.');
      } else {
        alert('There was an error starting voice recognition. Please try again.');
      }
      setIsRecording(false);
    }
  };

  // Add effect to save pending updates when user leaves or resets
  useEffect(() => {
    const savePendingUpdates = async () => {
      if (pendingUpdates.length === 0) return;

      try {
        await Promise.all(
          pendingUpdates.map(async (update) => {
            if (update.subtaskId) {
              await updateSubtaskCompletion(update.subtaskId, update.is_completed);
            } else {
              await updateTaskCompletion(update.taskId, update.is_completed);
            }
          })
        );
        setPendingUpdates([]);
      } catch (error) {
        console.error('Error saving completion updates:', error);
      }
    };

    // Save updates when component unmounts
    window.addEventListener('beforeunload', savePendingUpdates);
    return () => {
      window.removeEventListener('beforeunload', savePendingUpdates);
      savePendingUpdates();
    };
  }, [pendingUpdates, updateTaskCompletion, updateSubtaskCompletion]);

  if (!loading && !user) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white">
        {/* Hero Section */}
        <div className="relative overflow-hidden">
          {/* Background Pattern */}
          <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" />
          
          <div className="relative pt-24 pb-16 sm:pt-32 sm:pb-24">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
              <div className="mx-auto max-w-2xl text-center">
                <h1 className="text-4xl font-bold tracking-tight sm:text-6xl bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-teal-400">
                  Kairos
                </h1>
                <p className="mt-6 text-lg leading-8 text-gray-300">
                  Turn brain fog into clear, actionable daily tasks.
                </p>
                <div className="mt-10 flex items-center justify-center gap-x-6">
                  <button
                    onClick={() => signIn()}
                    className="rounded-xl bg-blue-500 px-8 py-4 text-lg font-semibold text-white shadow-sm hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 transition-all duration-200 flex items-center"
                  >
                    <img src="https://www.google.com/favicon.ico" alt="Google Favicon" className="h-5 w-5 mr-2" />
                    Login with Google 
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="mx-auto max-w-7xl px-6 lg:px-8 py-12">
          <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-16 lg:max-w-none lg:grid-cols-3">
            <div className="flex flex-col">
              <dt className="flex items-center gap-x-3 text-xl font-semibold leading-7 text-white">
                <svg className="h-5 w-5 flex-none text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
                AI-Powered Planning
              </dt>
              <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-400">
                <p className="flex-auto">Our AI breaks down your goals into clear, achievable tasks with estimated durations.</p>
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="flex items-center gap-x-3 text-xl font-semibold leading-7 text-white">
                <svg className="h-5 w-5 flex-none text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                  <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                </svg>
                Smart Subtasks
              </dt>
              <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-400">
                <p className="flex-auto">Break down complex tasks into smaller, manageable subtasks automatically.</p>
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="flex items-center gap-x-3 text-xl font-semibold leading-7 text-white">
                <svg className="h-5 w-5 flex-none text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
                </svg>
                Built-in Timer
              </dt>
              <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-400">
                <p className="flex-auto">Stay focused with our integrated timer that helps you track progress on each task.</p>
              </dd>
            </div>
          </dl>
        </div>

        {/* Why Section */}
        <div className="mx-auto max-w-7xl px-6 lg:px-8 py-24">
          <div className="text-center">
            <h2 className="text-2xl font-semibold leading-7 text-blue-400">Why Kairos?</h2>
            <p className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl max-w-3xl mx-auto">
              Bridge the gap between planning and action
            </p>
            
            <p className="mt-16 text-x font-medium text-white max-w-4xl mx-auto leading-relaxed">
              You know your goals, but juggling the big picture and small details can be overwhelming. Let us handle the mental load and break down your goals, giving you a clear roadmap instead of getting stuck in analysis paralysis.
            </p>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-auto py-12">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="border-t border-gray-800 pt-8">
              <p className="text-center text-sm leading-5 text-gray-400">
                built by <a href="https://x.com/mewtyunjay" className="text-blue-400 hover:text-blue-300 transition-colors">mewtyunjay</a>
              </p>
            </div>
          </div>
        </footer>
      </div>
    )
  }

  if (loading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  return (
    <>
      <Navbar onSigningOut={setIsSigningOut} />

      {(isLoading || isSigningOut) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-zinc-900 p-6 rounded-2xl flex flex-col items-center gap-4">
            <div className="w-16 h-16 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            <p className="text-zinc-400">
              {isSigningOut ? 'Signing out...' : (tasks.length > 0 ? 'Creating subtasks...' : 'Analyzing your tasks...')}
            </p>
          </div>
        </div>
      )}
      
      <main className="min-h-screen bg-gradient-to-b from-zinc-900 to-black text-white p-6 pt-24">
        {!hasStartedPlanning ? (
          <div className="max-w-2xl mx-auto space-y-8">
            <div>
              <h1 className="text-4xl font-bold mb-4">Plan Your Day</h1>
              <p className="text-zinc-400">
                Tell me what you want to accomplish today, and I'll help you break it down into manageable tasks.
              </p>
            </div>
            
            <div className="glass-panel rounded-2xl p-6">
              <textarea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Example: I need to write a blog post about AI, prepare for tomorrow's meeting, and fix a bug in our codebase."
                className="w-full h-32 bg-zinc-800/50 rounded-xl p-4 text-white placeholder-zinc-500 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
              />
              
              <div className="mt-4 flex justify-end items-center gap-2">
                <button
                  onClick={() => {
                    if (!('webkitSpeechRecognition' in window)) {
                      alert('Speech recognition is not supported in your browser.');
                      return;
                    }

                    // Stop any existing recognition
                    if (recognitionRef.current) {
                      recognitionRef.current.stop();
                    }

                    startSpeechRecognition();
                  }}
                  className={`p-3 ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-zinc-800 hover:bg-zinc-700'} text-white rounded-xl transition-all relative`}
                  title={isRecording ? "Recording..." : "Start voice input"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                    <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
                  </svg>
                  {isRecording && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                    </span>
                  )}
                </button>
                <button
                  onClick={handlePlanDay}
                  disabled={!userInput.trim()}
                  className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  Plan my day
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Active Tasks */}
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-2xl font-medium text-blue-400/90">
                  {new Date().toLocaleDateString('en-US', { 
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </p>
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-medium">Your Tasks</h2>
                  <button
                    onClick={handleReset}
                    className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-all flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                    </svg>
                    Start Over
                  </button>
                </div>
              </div>
              <motion.div layout className="space-y-4">
                <AnimatePresence mode="popLayout">
                  {tasks
                    .filter(task => !task.is_completed)
                    .sort((a, b) => a.priority - b.priority)
                    .map((task, index) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        index={index}
                        onUpdate={handleTaskUpdate}
                        onGenerateSubtasks={handleGenerateSubtasks}
                        onTimerClick={handleTimerClick}
                      />
                    ))}
                </AnimatePresence>
              </motion.div>
            </div>

            {/* Completed Tasks */}
            {tasks.some(task => task.is_completed) && (
              <div className="space-y-4">
                <button
                  onClick={() => setIsCompletedVisible(!isCompletedVisible)}
                  className="flex items-center gap-2 text-2xl font-medium text-gray-400 hover:text-white transition-colors"
                >
                  <svg
                    className={`w-6 h-6 transform transition-transform ${isCompletedVisible ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  Completed Tasks
                </button>
                
                {isCompletedVisible && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-4"
                  >
                    <AnimatePresence mode="popLayout">
                      {tasks
                        .filter(task => task.is_completed)
                        .map((task, index) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            index={index}
                            onUpdate={handleTaskUpdate}
                            onGenerateSubtasks={handleGenerateSubtasks}
                            onTimerClick={handleTimerClick}
                          />
                        ))}
                    </AnimatePresence>
                  </motion.div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
