export type SessionType = 'one-on-one' | 'expert-vs-crowd' | 'panel';

export interface Session {
    id : string;
    name : string;
    description? : string;
    type : SessionType;
    moderator_id : string; // moderator assigned by the expert
}