
export interface SGPGlobalConfig {
    baseUrl?: string;
    cpfFieldId?: string;
    appId?: string;
    appToken?: string;
    teamSectors?: Record<string, string>;
}

export interface SGPUserConfig {
    username?: string;
    password?: string;
    token?: string;
}

export type SGPConfig = SGPGlobalConfig & SGPUserConfig;
