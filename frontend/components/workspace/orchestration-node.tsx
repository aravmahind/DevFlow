'use client'

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { motion } from 'framer-motion'
import { useAppStore } from '@/lib/store'
import { useShallow } from 'zustand/react/shallow'
import {
  Lightbulb,
  CheckCircle,
  Zap,
  ListTodo,
  Rocket,
  AlertTriangle,
  DollarSign,
  PlayCircle,
} from 'lucide-react'

export type OrchestrationFlowNode = Node<{
  label: string
  iconType: 'lightbulb' | 'check-circle' | 'zap' | 'list-todo' | 'rocket' | 'alert-triangle' | 'dollar-sign' | 'play-circle'
  status: 'idle' | 'thinking' | 'analyzing' | 'generating' | 'complete'
  progress: number
}, 'orchestrationNode'>

const iconMap = {
  'lightbulb': <Lightbulb className="w-6 h-6 text-yellow-400" />,
  'check-circle': <CheckCircle className="w-6 h-6 text-blue-400" />,
  'zap': <Zap className="w-6 h-6 text-cyan-400" />,
  'list-todo': <ListTodo className="w-6 h-6 text-purple-400" />,
  'rocket': <Rocket className="w-6 h-6 text-pink-400" />,
  'alert-triangle': <AlertTriangle className="w-6 h-6 text-red-400" />,
  'dollar-sign': <DollarSign className="w-6 h-6 text-green-400" />,
  'play-circle': <PlayCircle className="w-6 h-6 text-cyan-400" />,
}

const statusColors = {
  idle: 'border-muted/50 bg-card/50',
  thinking: 'border-blue-500/50 bg-blue-500/10 animate-pulse-glow',
  analyzing: 'border-purple-500/50 bg-purple-500/10 animate-pulse-glow',
  generating: 'border-cyan-500/50 bg-cyan-500/10 animate-pulse-glow',
  complete: 'border-green-500/50 bg-green-500/10',
}

const statusLabels = {
  idle: 'Idle',
  thinking: 'Thinking...',
  analyzing: 'Analyzing...',
  generating: 'Generating...',
  complete: 'Complete',
}

export function OrchestrationNode({ data, id }: NodeProps<OrchestrationFlowNode>) {
  const { activeOrchestrationNode } = useAppStore(useShallow((s) => ({ activeOrchestrationNode: s.activeOrchestrationNode })))
  const isActive = activeOrchestrationNode === id

  return (
    <motion.div
      className={`px-6 py-4 rounded-lg border-2 transition-all duration-300 ${
        statusColors[data.status]
      } ${isActive ? 'ring-2 ring-primary shadow-lg shadow-primary/50' : ''}`}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.05 }}
      transition={{ type: 'spring', stiffness: 100 }}
    >
      <Handle type="target" position={Position.Top} />

      {/* Node content */}
      <div className="flex flex-col items-center gap-2 min-w-[120px]">
        {/* Icon */}
        <motion.div
          className="text-2xl"
          animate={data.status !== 'idle' ? { rotate: 360 } : {}}
          transition={{ duration: 2, repeat: Infinity, repeatType: 'loop' }}
        >
          {iconMap[data.iconType]}
        </motion.div>

        {/* Label */}
        <h3 className="font-semibold text-sm text-foreground text-center">{data.label}</h3>

        {/* Status */}
        <p className="text-xs text-muted-foreground">{statusLabels[data.status]}</p>

        {/* Progress bar */}
        {data.status !== 'idle' && data.status !== 'complete' && (
          <motion.div
            className="w-full h-1 bg-card/50 rounded-full overflow-hidden mt-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <motion.div
              className="h-full bg-slate-950"
              animate={{ width: `${data.progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </motion.div>
        )}

        {/* Complete checkmark */}
        {data.status === 'complete' && (
          <motion.div
            className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring' }}
          >
            ✓
          </motion.div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} />
    </motion.div>
  )
}
