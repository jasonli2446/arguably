export type Role = 'admin' | 'expert' | 'moderator' | 'debater' | 'audience';

export interface User {
    id : string;
    username : string;
    realname? : string;
    role : Role;
}