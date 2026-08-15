import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
} from "discord.js";

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  // Optional: implement to fill an option's dropdown as the user types. Discord
  // gives ~3 seconds to respond, so keep these to a single indexed query.
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}
