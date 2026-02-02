export type Role = 'admin' | 'creator' | 'moderator' | 'debater' | 'audience';

export interface User {
    id : string;
    username : string;
    realname? : string;
    role : Role;
}