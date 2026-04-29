import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { SessionType } from "@/lib/generated/prisma"

/** Merges conditional class names and resolves conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Formats a whole-second duration as M:SS for timers and replay controls. */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/** Generates a short human-readable room code with the ARG prefix. */
export function generateRoomCode(): string {
  const num = Math.floor(1000 + Math.random() * 9000)
  return `ARG-${num}`
}

/** Returns up to two uppercase initials from a display name. */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/** Placeholder user object used when a user record is unavailable. */
export const userStub = {
  id: 'N/A',
  username: 'N/A',
  realname: 'N/A',
}

/** Minimal session fields needed to compute total and debater capacity. */
export interface SessionCapacityInfo {
    sessionType: SessionType
    debaterCapacityProponent: number | null
    debaterCapacityOpponent: number | null
    debaterCapacityPanel: number | null
    audienceCapacity: number
}

/**
 * Calculates total session capacity, including the moderator slot.
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
 * Calculates total debater capacity by excluding audience and moderator slots.
 * @param capacityInfo - Object with debater capacity fields
 * @returns Total debater capacity
 */
export function getTotalDebaterCapacity(capacityInfo: SessionCapacityInfo): number {
    return getSessionCapacity(capacityInfo) - capacityInfo.audienceCapacity - 1;
}
