import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({ length: 50, unique: true })
  username: string;

  @Column('varchar', { length: 100, nullable: true })
  nickname: string | null;

  @Column('varchar', { name: 'avatar_img', length: 500, nullable: true })
  avatarImg: string | null;

  @Column('varchar', { length: 32, nullable: true })
  phone: string | null;

  @Column('varchar', { length: 255, nullable: true })
  address: string | null;

  @Column('varchar', { length: 32, default: 'normal' })
  role: string;

  @Column({ name: 'password_hash', length: 255 })
  passwordHash: string;

  @Column({ name: 'is_active', type: 'tinyint', width: 1, default: () => '1' })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt: Date | null;
}
