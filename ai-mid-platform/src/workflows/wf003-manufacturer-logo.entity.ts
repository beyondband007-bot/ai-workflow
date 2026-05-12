import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'wf_003_manufacturer_logos' })
export class Wf003ManufacturerLogo {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId!: number | null;

  @Column({ name: 'manufacturer_code', type: 'varchar', length: 64, unique: true })
  manufacturerCode!: string;

  @Column({ name: 'manufacturer_name', type: 'varchar', length: 128 })
  manufacturerName!: string;

  @Column({ name: 'logo_file_name', type: 'varchar', length: 255, nullable: true })
  logoFileName!: string | null;

  @Column({ name: 'logo_mime_type', type: 'varchar', length: 64 })
  logoMimeType!: string;

  @Column({ name: 'logo_public_url', type: 'varchar', length: 1000, nullable: true })
  logoPublicUrl!: string | null;

  @Column({ name: 'logo_content', type: 'longblob' })
  logoContent!: Buffer;

  @Column({ name: 'logo_sha256', type: 'char', length: 64, nullable: true })
  logoSha256!: string | null;

  @Column({ name: 'is_active', type: 'tinyint', width: 1, default: 1 })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
