export interface SeedAccount {
  name: string;
  email: string;
  password: string;
  role: "admin" | "super_admin";
  forcePasswordChange: boolean;
}

export const seedAccounts: SeedAccount[] = [
  {
    name: "Campus Admin",
    email: "admin@smvitm.ac.in",
    password: "SMVITMAdmin@2024",
    role: "admin",
    forcePasswordChange: false,
  },
  {
    name: "SMVITM Super Admin",
    email: "superadmin@smvitm.ac.in",
    password: "SMVITMSuperAdmin@2024",
    role: "super_admin",
    forcePasswordChange: false,
  },
];
