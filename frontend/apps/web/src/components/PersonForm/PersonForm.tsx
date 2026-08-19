import { type ReactNode, useId } from 'react';

import { Button, IconButton, Input, Label, Select, Textarea } from '@ci/shadcn';
import { Plus, Trash2 } from '@ci/shadcn/icons';

import {
  type PersonAddressDraft,
  type PersonContactDraft,
  type PersonContactKind,
  type PersonDraft,
  emptyAddress,
  emptyContact,
} from './personDraft';

/**
 * Suggestions, not a closed set. Gender, pronouns and contact labels are stored
 * as free text (imports carry values no dropdown would predict), so these are
 * offered through a `datalist` — the user can always type their own, and an
 * imported value is never silently rewritten to fit an enum.
 */
const GENDER_SUGGESTIONS = ['Woman', 'Man', 'Non-binary', 'Prefer not to say'];
const PRONOUN_SUGGESTIONS = ['she/her', 'he/him', 'they/them'];
const CONTACT_LABEL_SUGGESTIONS = ['home', 'work', 'mobile', 'other'];
const ADDRESS_LABEL_SUGGESTIONS = ['home', 'work', 'mailing', 'other'];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type,
  listId,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  listId?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        list={listId}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

interface Props {
  value: PersonDraft;
  onChange: (next: PersonDraft) => void;
  /** Shown under the name field; set when the caller rejected an empty name. */
  nameError?: string | null;
  disabled?: boolean;
}

/**
 * The full person editor — identity, contact methods, addresses, work, notes —
 * shared by the add and edit flows so the two can't drift apart.
 *
 * Contact methods and addresses are repeatable labelled rows rather than a
 * single field each: a person has a home address *and* a work one, a personal
 * email *and* a work email, and collapsing them loses which is which.
 */
export function PersonForm({ value, onChange, nameError, disabled }: Props) {
  const uid = useId();
  const genderListId = `${uid}-genders`;
  const pronounListId = `${uid}-pronouns`;
  const contactLabelListId = `${uid}-contact-labels`;
  const addressLabelListId = `${uid}-address-labels`;

  const set = <K extends keyof PersonDraft>(key: K, next: PersonDraft[K]) => {
    onChange({ ...value, [key]: next });
  };

  const updateContact = (key: string, patch: Partial<PersonContactDraft>) => {
    set(
      'contacts',
      value.contacts.map((contact) => (contact.key === key ? { ...contact, ...patch } : contact)),
    );
  };

  const updateAddress = (key: string, patch: Partial<PersonAddressDraft>) => {
    set(
      'addresses',
      value.addresses.map((address) => (address.key === key ? { ...address, ...patch } : address)),
    );
  };

  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-6">
      <datalist id={genderListId}>
        {GENDER_SUGGESTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id={pronounListId}>
        {PRONOUN_SUGGESTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id={contactLabelListId}>
        {CONTACT_LABEL_SUGGESTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id={addressLabelListId}>
        {ADDRESS_LABEL_SUGGESTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

      <Section title="Identity">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-name`}>Name</Label>
          <Input
            id={`${uid}-name`}
            value={value.name}
            autoFocus
            placeholder="Full name"
            onChange={(event) => set('name', event.target.value)}
          />
          {nameError ? (
            <p className="text-sm text-destructive">{nameError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Leave blank to build it from the first, middle and last name.
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            id={`${uid}-first-name`}
            label="First name"
            value={value.firstName}
            onChange={(next) => set('firstName', next)}
          />
          <Field
            id={`${uid}-middle-name`}
            label="Middle name"
            value={value.middleName}
            onChange={(next) => set('middleName', next)}
          />
          <Field
            id={`${uid}-last-name`}
            label="Last name"
            value={value.lastName}
            onChange={(next) => set('lastName', next)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id={`${uid}-nickname`}
            label="Nickname"
            value={value.nickname}
            placeholder="What you actually call them"
            onChange={(next) => set('nickname', next)}
          />
          <Field
            id={`${uid}-pronouns`}
            label="Pronouns"
            value={value.pronouns}
            listId={pronounListId}
            placeholder="they/them"
            onChange={(next) => set('pronouns', next)}
          />
          <Field
            id={`${uid}-gender`}
            label="Gender"
            value={value.gender}
            listId={genderListId}
            onChange={(next) => set('gender', next)}
          />
          <Field
            id={`${uid}-birth-date`}
            label="Birthday"
            type="date"
            value={value.birthDate}
            onChange={(next) => set('birthDate', next)}
          />
        </div>
      </Section>

      <Section title="Contact" description="The first email and the first phone are the preferred ones.">
        <div className="flex flex-col gap-2">
          {value.contacts.map((contact) => (
            <div key={contact.key} className="flex items-end gap-2">
              <div className="flex w-24 shrink-0 flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select
                  value={contact.kind}
                  onValueChange={(kind) => updateContact(contact.key, { kind: kind as PersonContactKind })}
                >
                  <Select.Trigger className="w-full">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="email">Email</Select.Item>
                    <Select.Item value="phone">Phone</Select.Item>
                  </Select.Content>
                </Select>
              </div>

              <div className="min-w-0 flex-1">
                <Field
                  id={`${uid}-${contact.key}-value`}
                  label={contact.kind === 'email' ? 'Email address' : 'Phone number'}
                  type={contact.kind === 'email' ? 'email' : 'tel'}
                  value={contact.value}
                  placeholder={contact.kind === 'email' ? 'name@example.com' : '+1 555 010 0100'}
                  onChange={(next) => updateContact(contact.key, { value: next })}
                />
              </div>

              <div className="w-28 shrink-0">
                <Field
                  id={`${uid}-${contact.key}-label`}
                  label="Label"
                  value={contact.label}
                  listId={contactLabelListId}
                  placeholder="home"
                  onChange={(next) => updateContact(contact.key, { label: next })}
                />
              </div>

              <IconButton
                type="button"
                variant="ghost"
                className="mb-0.5 size-9 shrink-0"
                label={`Remove ${contact.kind}`}
                onClick={() =>
                  set(
                    'contacts',
                    value.contacts.filter((other) => other.key !== contact.key),
                  )
                }
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => set('contacts', [...value.contacts, emptyContact('email')])}
          >
            <Plus className="size-4" /> Add email
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => set('contacts', [...value.contacts, emptyContact('phone')])}
          >
            <Plus className="size-4" /> Add phone
          </Button>
        </div>
      </Section>

      <Section title="Addresses" description="Label them home, work, or anything else that helps.">
        <div className="flex flex-col gap-3">
          {value.addresses.map((address, index) => (
            <div key={address.key} className="flex flex-col gap-3 rounded-md border border-border/60 p-3">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field
                    id={`${uid}-${address.key}-label`}
                    label={index === 0 ? 'Label (primary address)' : 'Label'}
                    value={address.label}
                    listId={addressLabelListId}
                    placeholder="home"
                    onChange={(next) => updateAddress(address.key, { label: next })}
                  />
                </div>
                <IconButton
                  type="button"
                  variant="ghost"
                  className="mb-0.5 size-9 shrink-0"
                  label="Remove address"
                  onClick={() =>
                    set(
                      'addresses',
                      value.addresses.filter((other) => other.key !== address.key),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>

              <Field
                id={`${uid}-${address.key}-street`}
                label="Street"
                value={address.streetAddress}
                onChange={(next) => updateAddress(address.key, { streetAddress: next })}
              />
              <Field
                id={`${uid}-${address.key}-street-2`}
                label="Apt, suite, floor"
                value={address.streetAddress2}
                onChange={(next) => updateAddress(address.key, { streetAddress2: next })}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id={`${uid}-${address.key}-city`}
                  label="City"
                  value={address.city}
                  onChange={(next) => updateAddress(address.key, { city: next })}
                />
                <Field
                  id={`${uid}-${address.key}-region`}
                  label="State / region"
                  value={address.region}
                  onChange={(next) => updateAddress(address.key, { region: next })}
                />
                <Field
                  id={`${uid}-${address.key}-postal-code`}
                  label="Postal code"
                  value={address.postalCode}
                  onChange={(next) => updateAddress(address.key, { postalCode: next })}
                />
                <Field
                  id={`${uid}-${address.key}-country`}
                  label="Country"
                  value={address.country}
                  onChange={(next) => updateAddress(address.key, { country: next })}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => set('addresses', [...value.addresses, emptyAddress('home')])}
          >
            <Plus className="size-4" /> Add home
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => set('addresses', [...value.addresses, emptyAddress('work')])}
          >
            <Plus className="size-4" /> Add work
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => set('addresses', [...value.addresses, emptyAddress()])}
          >
            <Plus className="size-4" /> Add other
          </Button>
        </div>
      </Section>

      <Section title="Work">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id={`${uid}-job-title`}
            label="Job title"
            value={value.jobTitle}
            onChange={(next) => set('jobTitle', next)}
          />
          <Field
            id={`${uid}-organization`}
            label="Organization"
            value={value.organization}
            onChange={(next) => set('organization', next)}
          />
          <Field
            id={`${uid}-department`}
            label="Department"
            value={value.department}
            onChange={(next) => set('department', next)}
          />
          <Field
            id={`${uid}-website`}
            label="Website"
            type="url"
            value={value.website}
            placeholder="https://"
            onChange={(next) => set('website', next)}
          />
        </div>
      </Section>

      <Section title="Notes">
        <Field
          id={`${uid}-avatar-url`}
          label="Avatar URL"
          type="url"
          value={value.avatarUrl}
          placeholder="https://"
          onChange={(next) => set('avatarUrl', next)}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-description`} className="text-xs text-muted-foreground">
            Description
          </Label>
          <Textarea
            id={`${uid}-description`}
            value={value.description}
            placeholder="How you know them, anything worth remembering"
            onChange={(event) => set('description', event.target.value)}
          />
        </div>
      </Section>
    </fieldset>
  );
}
