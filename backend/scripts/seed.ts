export interface SeedAccount {
  name: string;
  email: string;
  password: string;
  role: "admin" | "super_admin";
  forcePasswordChange: boolean;
}

export const seedAccounts = (accounts: SeedAccount[]): SeedAccount[] => accounts;
