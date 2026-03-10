import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { SessionType } from "@/lib/generated/prisma"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function generateRoomCode(): string {
  const num = Math.floor(1000 + Math.random() * 9000)
  return `ARG-${num}`
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export const userStub = {
  id: 'N/A',
  username: 'N/A',
  realname: 'N/A',
}

// Type for session capacity info to avoid refetching
export interface SessionCapacityInfo {
    sessionType: SessionType
    debaterCapacityProponent: number | null
    debaterCapacityOpponent: number | null
    debaterCapacityPanel: number | null
    audienceCapacity: number
}

/**
 * Calculate total session capacity, +1 for including moderator
 * @param capacityInfo - Object with debater and audience capacity fields
 * @returns Total session capacity
 */
export function getSessionCapacity(capacityInfo: SessionCapacityInfo): number {
    if (capacityInfo.sessionType === SessionType.PANEL) {
        return (capacityInfo.debaterCapacityPanel ?? 0) + capacityInfo.audienceCapacity + 1
    } 
    else {
        return (capacityInfo.debaterCapacityProponent ?? 0) + 
        (capacityInfo.debaterCapacityOpponent ?? 0) + 
        capacityInfo.audienceCapacity + 1
    }
}

/**
 * Calculate total debater capacity (proponent + opponent)
 * @param capacityInfo - Object with debater capacity fields
 * @returns Total debater capacity
 */
export function getTotalDebaterCapacity(capacityInfo: SessionCapacityInfo): number {
    return getSessionCapacity(capacityInfo) - capacityInfo.audienceCapacity - 1;
}