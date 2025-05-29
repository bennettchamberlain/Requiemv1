import { Injectable } from '@nestjs/common';
import { UserService } from '../user';

@Injectable()
export class AuthService {
  constructor(private userService: UserService) {}

  validateUser(username: string, password: string) {
    return this.userService.validatePassword(username, password);
  }
}
