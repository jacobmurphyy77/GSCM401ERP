export const employeeRoles = ["sales", "warehouse", "production", "finance", "manager"] as const;
export type EmployeeRole = typeof employeeRoles[number];
export type EmployeeRecord = { id: string; display_name: string; email: string; role: string; created_at: string; last_sign_in_at: string | null };

export const employeeRoleDescriptions: Record<EmployeeRole, string> = {
  sales: "Sales, pickup orders, and customer service",
  warehouse: "Inventory, transfers, and receiving",
  production: "Bike builds and quality records",
  finance: "Financial and management reports",
  manager: "All employee workflows and employee account creation",
};

export function generateTemporaryPassword() {
  const random = new Uint32Array(20);
  crypto.getRandomValues(random);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*-_=+";
  // Guaranteed character classes plus independent random characters. The password
  // exists only in component state until the manager submits the HTTPS request.
  return "Wc9!" + [...random].map((value) => alphabet[value % alphabet.length]).join("");
}

export function validEmployeePassword(value: string) {
  return value.length >= 12 && value.length <= 72 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^a-zA-Z0-9\s]/.test(value) && value.trim() === value;
}
