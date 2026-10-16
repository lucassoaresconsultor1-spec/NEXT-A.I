import { z } from "zod";
import { emailField, optionalCnpj, passwordField, requiredText } from "@/server/forms";

export const signInSchema = z.object({
  email: emailField,
  // Length is checked on sign-up; here only bound the work done per attempt.
  password: z.string({ error: "Informe a senha." }).min(1, { error: "Informe a senha." }).max(128),
});

export const signUpSchema = z.object({
  name: requiredText("seu nome", 120, 2),
  email: emailField,
  password: passwordField,
  organizationName: requiredText("o nome da empresa", 120, 2),
  organizationDocument: optionalCnpj,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: "Informe a senha atual." }).min(1, { error: "Informe a senha atual." }).max(128),
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    error: "As senhas não conferem.",
    path: ["confirmPassword"],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    error: "A nova senha precisa ser diferente da atual.",
    path: ["newPassword"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;
