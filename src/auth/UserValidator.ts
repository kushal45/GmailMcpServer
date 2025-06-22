export interface UserValidator {
  validateUser(userId: string): Promise<boolean>;
  getValidUsers(): Promise<string[]>;
}

export class ProductionUserValidator implements UserValidator {
  private validUsers: string[] = ['user-1', 'user-2', 'admin-user'];

  async validateUser(userId: string): Promise<boolean> {
    // In a real application, this would integrate with your auth/user management system
    // such as:
    // - User authentication service/database
    // - User management system
    // - LDAP/Active Directory
    // - External identity provider (Auth0, Okta, etc.)
    // - User registration system
    
    return this.validUsers.includes(userId);
  }

  async getValidUsers(): Promise<string[]> {
    return [...this.validUsers];
  }
}

export class TestUserValidator implements UserValidator {
  private validUsers: string[] = [];

  constructor(validUsers: string[] = []) {
    this.validUsers = validUsers;
  }

  async validateUser(userId: string): Promise<boolean> {
    // For testing, we can accept any user or use a custom list
    return this.validUsers.length === 0 || this.validUsers.includes(userId);
  }

  async getValidUsers(): Promise<string[]> {
    return [...this.validUsers];
  }

  // Helper method for tests to add valid users
  addValidUser(userId: string): void {
    if (!this.validUsers.includes(userId)) {
      this.validUsers.push(userId);
    }
  }

  // Helper method for tests to set all valid users
  setValidUsers(users: string[]): void {
    this.validUsers = [...users];
  }
}